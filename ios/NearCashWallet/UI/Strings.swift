import Foundation

/// Every user-facing text, in one place (Italian). To translate the app,
/// translate this file (or move it to a String Catalog).
enum Strings {
    /// Dates and numbers follow the language of the texts, whatever the device region.
    static let locale = Locale(identifier: "it_IT")
    static let decimalSeparator = locale.decimalSeparator ?? ","

    // Home
    static let homeTitle = "Verifica una banconota"
    static let homeSubtitle = "Avvicina la card alla parte alta dell’iPhone. Funziona anche senza rete."
    static let verifyButton = "Verifica banconota"

    // NFC sheet
    static let promptVerify = "Avvicina la banconota alla parte alta dell’iPhone"
    static let promptTakeOver = "Avvicina di nuovo la banconota per prenderla in carico"
    static let nfcOneCardOnly = "Avvicina una sola banconota NearCash"
    static let nfcConnectionLost = "Connessione persa, riprova"
    static let nfcSheetError = "Operazione non riuscita"
    static let nfcValid = "Banconota valida"
    static let nfcSpent = "Banconota già spesa"
    static let nfcInvalid = "Banconota non valida"
    static let nfcTakenOver = "La banconota è tua"

    // Result
    static let statusValid = "Banconota valida"
    static let statusSpent = "Già spesa"
    static let statusInvalid = "Non valida"
    static let messageValid = "Autentica e mai riscattata. Puoi accettarla."
    static let issuer = "Emittente"
    static let issuedAt = "Emessa il"
    static let pinTries = "Tentativi PIN"
    static let takeOverButton = "Prendi in carico"
    static let close = "Chiudi"
    static let stampSpent = "SPESA"
    static let stampInvalid = "NON VALIDA"

    static func failure(_ failure: BanknoteCheck.Failure) -> String {
        switch failure {
        case .notIssued: "Questa card non è una banconota emessa."
        case .malformedCertificate: "Il certificato della banconota è illeggibile."
        case .untrustedIssuer: "Emessa da un emittente sconosciuto: non accettarla."
        case .badCertificateSignature: "Il certificato è stato alterato: non accettarla."
        case .keyMismatch: "Il certificato appartiene a un’altra card: possibile falso."
        case .badAuthSignature: "La card non ha superato la prova di autenticità: possibile falso."
        case .stateMismatch: "La card ha dato risposte incoerenti: non accettarla."
        }
    }

    static let messageSpent = "Questa banconota è già stata riscattata e non vale più nulla."

    // Take over (CHANGE_PIN)
    static let givenPinTitle = "PIN ricevuto"
    static let givenPinSubtitle = "Inserisci il PIN che ti ha detto chi ti dà la banconota."
    static let newPinTitle = "Nuovo PIN"
    static let newPinSubtitle = "Scegli 4–8 cifre. Da ora solo tu potrai riscattarla."
    static let confirmPinTitle = "Conferma il PIN"
    static let confirmPinSubtitle = "Inserisci di nuovo il nuovo PIN."
    static let continueButton = "Continua"
    static func step(_ number: Int, of total: Int) -> String { "Passo \(number) di \(total)" }
    static let pinMismatch = "I due PIN non coincidono. Riprova."
    static let pinSameAsGiven = "Il nuovo PIN deve essere diverso da quello ricevuto."
    static func wrongPin(triesLeft: Int) -> String {
        "PIN ricevuto errato. Tentativi rimasti: \(triesLeft)."
    }
    static let pinBlocked = "PIN bloccato: questa banconota non può più essere riscattata."
    static let successTitle = "La banconota è tua"
    static let successSubtitle = "Hai cambiato il PIN: ora solo tu puoi riscattarla."
    static let done = "Fatto"

    // Errors
    static let nfcUnavailable = "Questo dispositivo non può leggere card NFC."
    static let connectionLost = "La banconota si è allontanata. Riprova tenendola ferma."
    static func generic(_ error: Error) -> String {
        "Errore: \(error)"
    }
}
