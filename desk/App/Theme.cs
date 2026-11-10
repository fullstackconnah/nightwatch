using System.Windows;
using System.Windows.Media;
using System.Windows.Controls;

namespace NightwatchDesk.App;

/// <summary>Attached flags that set a visual state under RenderTargetBitmap, where IsMouseOver and keyboard focus can't be faked.</summary>
public static class Snap
{
    public static readonly DependencyProperty ForceHoverProperty =
        DependencyProperty.RegisterAttached("ForceHover", typeof(bool), typeof(Snap), new PropertyMetadata(false));
    public static readonly DependencyProperty ForceFocusProperty =
        DependencyProperty.RegisterAttached("ForceFocus", typeof(bool), typeof(Snap), new PropertyMetadata(false));
    public static void SetForceHover(DependencyObject o, bool v) => o.SetValue(ForceHoverProperty, v);
    public static bool GetForceHover(DependencyObject o) => (bool)o.GetValue(ForceHoverProperty);
    public static void SetForceFocus(DependencyObject o, bool v) => o.SetValue(ForceFocusProperty, v);
    public static bool GetForceFocus(DependencyObject o) => (bool)o.GetValue(ForceFocusProperty);
}

/// <summary>Loads Tokens.xaml into the Application and reads tokens back by their DESIGN.md names.</summary>
internal static class Theme
{
    public static void EnsureLoaded()
    {
        var app = Application.Current ?? new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        if (app.Resources.MergedDictionaries.Count > 0) return;
        app.Resources.MergedDictionaries.Add(new ResourceDictionary { Source = new Uri("pack://application:,,,/NightwatchDesk;component/Tokens.xaml") });
        if (SystemParameters.HighContrast) HighContrast(app.Resources);
    }

    // Windows' own colours replace the palette. shortcut: hover has no fill in high contrast, only the cursor and the focus ring.
    static void HighContrast(ResourceDictionary r)
    {
        foreach (var k in new[] { "bg", "panel", "panel-2" }) r[k] = SystemColors.WindowBrush;
        foreach (var k in new[] { "line", "line-bright", "ink" }) r[k] = SystemColors.WindowTextBrush;
        foreach (var k in new[] { "ink-dim", "ink-faint" }) r[k] = SystemColors.GrayTextBrush;
        foreach (var k in new[] { "warn", "bad" }) r[k] = SystemColors.WindowTextBrush;
        r["accent"] = SystemColors.HighlightBrush;
    }

    public static double D(string key) => (double)Application.Current.Resources[key];
    public static Brush B(string key) => (Brush)Application.Current.Resources[key];
    public static FontFamily F(string key) => (FontFamily)Application.Current.Resources[key];
    public static Color C(string key) => (Color)Application.Current.Resources[key];

    public static TextBlock Text(string text, string size, string lineHeight, string brush, bool mono = false, bool semibold = false, bool wrap = false)
    {
        var t = new TextBlock
        {
            Text = text,
            FontFamily = F(mono ? "font-mono" : "font-sans"),
            FontSize = D(size),
            LineHeight = D(lineHeight),
            LineStackingStrategy = LineStackingStrategy.BlockLineHeight,
            Foreground = B(brush),
            FontWeight = semibold ? FontWeights.SemiBold : FontWeights.Normal,
            TextWrapping = wrap ? TextWrapping.Wrap : TextWrapping.NoWrap,
            TextTrimming = wrap ? TextTrimming.None : TextTrimming.CharacterEllipsis,
        };
        return t;
    }
}
