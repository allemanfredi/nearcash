import SwiftUI

/// What the card turned out to be, and — if valid — the way to take it over.
struct ResultView: View {
    let check: BanknoteCheck
    let model: WalletModel

    @Environment(\.dismiss) private var dismiss
    @State private var isTakingOver = false
    @State private var hasAppeared = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 28) {
                    BanknoteView(
                        style: style,
                        amount: check.certificate?.formattedAmount(decimalSeparator: Strings.decimalSeparator),
                        symbol: check.certificate?.symbol
                    )

                    VStack(spacing: 10) {
                        Label(title, systemImage: symbolName)
                            .font(.title2.bold())
                            .foregroundStyle(tint)
                            .symbolEffect(.bounce, value: hasAppeared)
                            .accessibilityIdentifier("resultStatus")
                        Text(message)
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }

                    if !details.isEmpty {
                        DetailsList(rows: details)
                    }
                }
                .padding(24)
            }
            .safeAreaInset(edge: .bottom) { actions }
            .navigationDestination(isPresented: $isTakingOver) {
                TakeOverView(model: model, certificate: check.certificate) { dismiss() }
            }
        }
        .onAppear { hasAppeared = true }
        .sensoryFeedback(feedback, trigger: hasAppeared)
    }

    // MARK: - Pieces

    @ViewBuilder
    private var actions: some View {
        VStack(spacing: 4) {
            if check.outcome == .valid {
                Button(Strings.takeOverButton) { isTakingOver = true }
                    .buttonStyle(PrimaryButtonStyle())
                    .accessibilityIdentifier("takeOverButton")
            }
            Button(Strings.close) { dismiss() }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityIdentifier("closeResultButton")
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 8)
        .background(.bar)
    }

    private var details: [(String, String)] {
        var rows: [(String, String)] = []
        if let issuer = check.issuer, check.outcome == .valid {
            rows.append((Strings.issuer, issuer.name))
        }
        if let certificate = check.certificate {
            // Certificates carry the issue day only (00:00 UTC), never the time
            // of purchase: show the date, in UTC so it is the same day everywhere.
            let style = Date.FormatStyle(date: .long, time: .omitted, locale: Strings.locale, timeZone: .gmt)
            rows.append((Strings.issuedAt, certificate.issuedAt.formatted(style)))
        }
        if check.outcome == .valid {
            rows.append((Strings.pinTries, "\(check.info.pinTriesRemaining)"))
        }
        return rows
    }

    // MARK: - Outcome → presentation

    private var style: BanknoteView.Style {
        switch check.outcome {
        case .valid: .valid
        case .spent: .spent
        case .invalid: .invalid
        }
    }

    private var title: String {
        switch check.outcome {
        case .valid: Strings.statusValid
        case .spent: Strings.statusSpent
        case .invalid: Strings.statusInvalid
        }
    }

    private var message: String {
        switch check.outcome {
        case .valid: Strings.messageValid
        case .spent: Strings.messageSpent
        case let .invalid(failure): Strings.failure(failure)
        }
    }

    private var symbolName: String {
        switch check.outcome {
        case .valid: "checkmark.seal.fill"
        case .spent: "exclamationmark.triangle.fill"
        case .invalid: "xmark.octagon.fill"
        }
    }

    private var tint: Color {
        switch check.outcome {
        case .valid: Theme.accent
        case .spent: .orange
        case .invalid: .red
        }
    }

    private var feedback: SensoryFeedback {
        switch check.outcome {
        case .valid: .success
        case .spent: .warning
        case .invalid: .error
        }
    }
}

/// Label/value rows in a rounded group.
private struct DetailsList: View {
    let rows: [(String, String)]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                HStack {
                    Text(row.0).foregroundStyle(.secondary)
                    Spacer(minLength: 16)
                    Text(row.1).multilineTextAlignment(.trailing)
                }
                .font(.subheadline)
                .padding(.vertical, 12)
                if index < rows.count - 1 { Divider() }
            }
        }
        .padding(.horizontal, 16)
        .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 16))
    }
}
