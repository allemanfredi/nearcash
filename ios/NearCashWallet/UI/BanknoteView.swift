import SwiftUI

/// The banknote as a card: ID-1 proportions, amount large, status in the colour.
struct BanknoteView: View {

    enum Style {
        case valid, spent, invalid
        /// Home screen: an empty card waiting to be tapped.
        case placeholder
    }

    let style: Style
    var amount: String? = nil
    var symbol: String? = nil
    /// Animates the NFC waves (while a card is being read).
    var isReading = false

    /// ISO/IEC 7810 ID-1: 85.60 × 53.98 mm.
    private let aspectRatio = 85.60 / 53.98

    var body: some View {
        RoundedRectangle(cornerRadius: 22, style: .continuous)
            .fill(Theme.banknoteGradient(style))
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(.white.opacity(style == .placeholder ? 0 : 0.15), lineWidth: 1)
            }
            .overlay(alignment: .topLeading) { header.padding(22) }
            .overlay(alignment: .bottomLeading) { value.padding(22) }
            .overlay { stamp }
            .aspectRatio(aspectRatio, contentMode: .fit)
            .shadow(color: .black.opacity(style == .placeholder ? 0.06 : 0.18), radius: 18, y: 10)
            .accessibilityElement(children: .combine)
    }

    private var foreground: Color {
        style == .placeholder ? .secondary : .white
    }

    private var header: some View {
        HStack {
            Text("NearCash")
                .font(.headline)
            Spacer()
            Image(systemName: "wave.3.right")
                .font(.title3)
                .symbolEffect(.variableColor.iterative, isActive: isReading)
        }
        .foregroundStyle(foreground)
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var value: some View {
        if let amount, let symbol {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(amount)
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                Text(symbol)
                    .font(.title3.weight(.semibold))
                    .opacity(0.8)
            }
            .foregroundStyle(foreground)
        } else {
            // Contact-chip outline, purely decorative.
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(foreground.opacity(0.5), lineWidth: 1.5)
                .frame(width: 44, height: 34)
        }
    }

    @ViewBuilder
    private var stamp: some View {
        switch style {
        case .spent: Stamp(text: Strings.stampSpent)
        case .invalid: Stamp(text: Strings.stampInvalid)
        case .valid, .placeholder: EmptyView()
        }
    }
}

/// Diagonal rubber stamp over a banknote that must not be accepted.
private struct Stamp: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 28, weight: .heavy, design: .rounded))
            .tracking(4)
            .foregroundStyle(.white.opacity(0.9))
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(.white.opacity(0.9), lineWidth: 3))
            .rotationEffect(.degrees(-14))
            .offset(y: -16) // keep clear of the amount in the bottom-left corner
    }
}

#Preview {
    VStack(spacing: 20) {
        BanknoteView(style: .placeholder)
        BanknoteView(style: .valid, amount: "0,01", symbol: "ETH")
        BanknoteView(style: .spent, amount: "0,01", symbol: "ETH")
    }
    .padding()
}
