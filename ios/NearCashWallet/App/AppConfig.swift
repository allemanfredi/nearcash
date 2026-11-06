import Foundation

/// Settings that come from the build (ios/Secrets.xcconfig → Info.plist),
/// not from the code. Both are needed to redeem; verifying and taking over
/// a banknote need neither, and work offline.
struct AppConfig {
    /// The wallet's own 1Click partner key: confidential (FAR) quotes need one.
    let oneClickAPIKey: String?
    /// The domain the refund passkey belongs to.
    let passkeyDomain: String?

    static let current = AppConfig(bundle: .main)

    init(oneClickAPIKey: String?, passkeyDomain: String?) {
        self.oneClickAPIKey = oneClickAPIKey
        self.passkeyDomain = passkeyDomain
    }

    init(bundle: Bundle) {
        func value(_ key: String) -> String? {
            let text = (bundle.object(forInfoDictionaryKey: key) as? String)?.trimmingCharacters(in: .whitespaces)
            // An unset build setting leaves the value empty.
            return (text?.isEmpty ?? true) ? nil : text
        }
        oneClickAPIKey = value("NearCashOneClickAPIKey")
        passkeyDomain = value("NearCashPasskeyDomain")
    }

    var canRedeem: Bool { oneClickAPIKey != nil && passkeyDomain != nil }
}
