import SwiftUI
import UIKit

/// Colours and shared styles. One accent, system backgrounds, nothing else.
enum Theme {

    /// Deep green; lighter in dark mode for contrast.
    static let accent = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.31, green: 0.68, blue: 0.54, alpha: 1)
            : UIColor(red: 0.12, green: 0.37, blue: 0.29, alpha: 1)
    })

    /// Text and icons drawn on top of `accent`: white on the dark green,
    /// near-black on the lighter green of dark mode (readable contrast in both).
    static let onAccent = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0.05, green: 0.12, blue: 0.09, alpha: 1)
            : .white
    })

    /// Fill of the banknote illustration, by status.
    static func banknoteGradient(_ style: BanknoteView.Style) -> LinearGradient {
        let colors: [Color]
        switch style {
        case .valid:
            colors = [Color(red: 0.16, green: 0.47, blue: 0.36), Color(red: 0.05, green: 0.24, blue: 0.18)]
        case .spent:
            colors = [Color(red: 0.55, green: 0.55, blue: 0.58), Color(red: 0.29, green: 0.29, blue: 0.31)]
        case .invalid:
            colors = [Color(red: 0.70, green: 0.20, blue: 0.16), Color(red: 0.38, green: 0.08, blue: 0.07)]
        case .placeholder:
            colors = [Color(.secondarySystemBackground), Color(.tertiarySystemBackground)]
        }
        return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

/// Full-width, filled, rounded: the one primary action of a screen.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 56)
            .foregroundStyle(Theme.onAccent)
            .background(Theme.accent.opacity(isEnabled ? 1 : 0.4), in: .rect(cornerRadius: 16))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}

/// Quiet text-only action under a primary button.
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 48)
            .foregroundStyle(Theme.accent)
            .opacity(configuration.isPressed ? 0.5 : 1)
    }
}
