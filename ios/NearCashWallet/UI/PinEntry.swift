import SwiftUI

/// Title, PIN dots, keypad, continue. Shared by the PIN steps of taking
/// over a banknote and by the one of redeeming it.
struct PinEntryView: View {
    let stepNumber: Int
    var totalSteps = 3
    let title: String
    let subtitle: String
    @Binding var pin: String
    let errorMessage: String?
    let isWorking: Bool
    let onContinue: () -> Void

    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 8) {
                Text(Strings.step(stepNumber, of: totalSteps))
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.accent)
                    .textCase(.uppercase)
                Text(title).font(.title2.bold())
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.top, 8)

            PinDots(count: pin.count)

            Text(errorMessage ?? " ")
                .font(.footnote)
                .foregroundStyle(.red)
                .multilineTextAlignment(.center)
                .frame(minHeight: 36)
                .accessibilityIdentifier("pinError")

            Spacer(minLength: 0)

            PinPad(pin: $pin)

            Button(action: onContinue) {
                if isWorking {
                    ProgressView().tint(Theme.onAccent)
                } else {
                    Text(Strings.continueButton)
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!NearCashProtocol.isValidPin(pin) || isWorking)
            .accessibilityIdentifier("pinContinue")
        }
        .padding(24)
    }
}

/// Filled dots for typed digits; at least four slots so the length is clear.
private struct PinDots: View {
    let count: Int

    var body: some View {
        HStack(spacing: 14) {
            ForEach(0..<max(NearCashProtocol.pinLengths.lowerBound, count), id: \.self) { index in
                Circle()
                    .fill(index < count ? Theme.accent : Color(.tertiarySystemFill))
                    .frame(width: 14, height: 14)
                    .scaleEffect(index < count ? 1 : 0.85)
            }
        }
        .animation(.snappy(duration: 0.15), value: count)
        .accessibilityElement()
        .accessibilityLabel(Strings.pinDigitsEntered(count))
    }
}

/// Phone-style numeric keypad, 4–8 digits.
private struct PinPad: View {
    @Binding var pin: String

    private let rows: [[String]] = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["", "0", "⌫"]]

    var body: some View {
        VStack(spacing: 14) {
            ForEach(rows, id: \.self) { row in
                HStack(spacing: 28) {
                    ForEach(row, id: \.self) { key in
                        keyButton(key)
                    }
                }
            }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: pin)
    }

    @ViewBuilder
    private func keyButton(_ key: String) -> some View {
        switch key {
        case "":
            Color.clear.frame(width: 76, height: 76)
        case "⌫":
            Button {
                if !pin.isEmpty { pin.removeLast() }
            } label: {
                Image(systemName: "delete.left")
                    .font(.title2)
                    .frame(width: 76, height: 76)
            }
            .foregroundStyle(.primary)
            .accessibilityLabel(Strings.pinDelete)
            .accessibilityIdentifier("pinDelete")
        default:
            Button {
                if pin.count < NearCashProtocol.pinLengths.upperBound { pin.append(key) }
            } label: {
                Text(key)
                    .font(.system(size: 32, weight: .regular, design: .rounded))
                    .frame(width: 76, height: 76)
                    .background(Color(.secondarySystemBackground), in: .circle)
            }
            .foregroundStyle(.primary)
            .accessibilityIdentifier("pinKey\(key)")
        }
    }
}

