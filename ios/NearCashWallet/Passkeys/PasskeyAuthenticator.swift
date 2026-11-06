import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

/// Creates the refund passkey and signs with it, through iOS (AuthenticationServices).
///
/// The passkey belongs to a domain (the WebAuthn relying party) that must
/// list the app in its apple-app-site-association file (Secrets.xcconfig.example
/// explains the setup). NEAR Intents checks the signature, the challenge and
/// the flags of an assertion, not the domain (near/intents,
/// crates/signatures/webauthn), so any domain of ours works.
@MainActor
final class PasskeyAuthenticator: NSObject {

    let relyingParty: String
    private var pending: CheckedContinuation<ASAuthorization, Error>?
    /// Kept alive while iOS shows its sheet.
    private var controller: ASAuthorizationController?

    init(relyingParty: String) {
        self.relyingParty = relyingParty
    }

    /// Creates the passkey (iOS asks for Face ID) and returns the account it controls.
    func createRefundAccount() async throws -> RefundAccount {
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: relyingParty)
        let request = provider.createCredentialRegistrationRequest(
            // Registration challenges matter to servers that verify the
            // attestation; nobody does here, so a random one is enough.
            challenge: Self.randomBytes(32),
            name: Strings.passkeyName,
            userID: Self.randomBytes(16)
        )
        request.userVerificationPreference = .required

        guard let registration = try await perform(request).credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
              let attestationObject = registration.rawAttestationObject else {
            throw RefundPasskeyError.failed("iOS returned no attestation object")
        }
        let extracted = try COSEPublicKey.p256Key(fromAttestationObject: attestationObject)
        guard extracted.credentialID == registration.credentialID else {
            throw RefundPasskeyError.failed("credential id mismatch")
        }
        return RefundAccount(credentialID: extracted.credentialID, publicKey: extracted.publicKey, relyingParty: relyingParty)
    }

    /// Signs an intent payload with the passkey, as a WebAuthn assertion.
    ///
    /// The challenge is SHA-256 of the payload: what NEAR Intents checks the
    /// assertion against (near/intents, SignedWebAuthnPayload::hash). The
    /// passkey signs authenticatorData ‖ SHA-256(clientDataJSON), and
    /// clientDataJSON contains the challenge.
    func sign(payload: String, with account: RefundAccount) async throws -> WebAuthnSignedIntent {
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: account.relyingParty)
        let challenge = Data(SHA256.hash(data: Data(payload.utf8)))
        let request = provider.createCredentialAssertionRequest(challenge: challenge)
        request.allowedCredentials = [ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: account.credentialID)]
        request.userVerificationPreference = .required

        guard let assertion = try await perform(request).credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion,
              let authenticatorData = assertion.rawAuthenticatorData,
              let signature = assertion.signature else {
            throw RefundPasskeyError.badAssertion("incomplete")
        }
        guard assertion.credentialID == account.credentialID else {
            throw RefundPasskeyError.badAssertion("signed by another passkey")
        }
        guard let clientDataJSON = String(data: assertion.rawClientDataJSON, encoding: .utf8) else {
            throw RefundPasskeyError.badAssertion("clientDataJSON is not text")
        }

        // Check it as Intents will, before anything is submitted.
        let compact = try P256Signatures.compactLowS(derSignature: signature)
        let signedBytes = authenticatorData + Data(SHA256.hash(data: assertion.rawClientDataJSON))
        guard P256Signatures.isValid(compact: compact, message: signedBytes, publicKey: account.publicKey) else {
            throw RefundPasskeyError.badAssertion("the signature does not verify with the refund account's key")
        }

        return WebAuthnSignedIntent(
            payload: payload,
            publicKey: account.publicKeyText,
            signature: "p256:" + Base58.encode(compact),
            clientDataJSON: clientDataJSON,
            authenticatorData: Base64URL.encode(authenticatorData)
        )
    }

    // MARK: - Plumbing

    private func perform(_ request: ASAuthorizationRequest) async throws -> ASAuthorization {
        try await withCheckedThrowingContinuation { continuation in
            pending = continuation
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.controller = controller
            controller.performRequests()
        }
    }

    private func finish(_ result: Result<ASAuthorization, Error>) {
        pending?.resume(with: result)
        pending = nil
        controller = nil
    }

    private static func randomBytes(_ count: Int) -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        _ = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        return Data(bytes)
    }
}

extension PasskeyAuthenticator: ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        Task { @MainActor in self.finish(.success(authorization)) }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let cancelled = (error as? ASAuthorizationError)?.code == .canceled
        let failure: Error = cancelled ? RefundPasskeyError.cancelled : RefundPasskeyError.failed(error.localizedDescription)
        Task { @MainActor in self.finish(.failure(failure)) }
    }

    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
        }
    }
}
