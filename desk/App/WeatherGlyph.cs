using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using NightwatchDesk.Core;

namespace NightwatchDesk.App;

/// <summary>The weather glyphs: lucide path data (ISC), copied from the repo's installed lucide-react, drawn as WPF geometry. No image files, no font code points.</summary>
internal static class WeatherGlyph
{
    const string CloudTop = "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242";

    // One string per lucide element: a relative "m" opens a subpath, so each element parses on its own.
    static readonly Dictionary<string, string[]> Data = new()
    {
        ["sun"] = ["M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0", "M12 2v2", "M12 20v2", "m4.93 4.93 1.41 1.41", "m17.66 17.66 1.41 1.41", "M2 12h2", "M20 12h2", "m6.34 17.66-1.41 1.41", "m19.07 4.93-1.41 1.41"],
        ["cloud-sun"] = ["M12 2v2", "m4.93 4.93 1.41 1.41", "M20 12h2", "m19.07 4.93-1.41 1.41", "M15.947 12.65a4 4 0 0 0-5.925-4.128", "M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"],
        ["cloud"] = ["M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"],
        ["cloud-fog"] = [CloudTop, "M16 17H7", "M17 21H9"],
        ["cloud-drizzle"] = [CloudTop, "M8 19v1", "M8 14v1", "M16 19v1", "M16 14v1", "M12 21v1", "M12 16v1"],
        ["cloud-rain"] = [CloudTop, "M16 14v6", "M8 14v6", "M12 16v6"],
        ["cloud-snow"] = [CloudTop, "M8 15h.01", "M8 19h.01", "M12 17h.01", "M12 21h.01", "M16 15h.01", "M16 19h.01"],
        ["cloud-rain-wind"] = [CloudTop, "m9.2 22 3-7", "m9 13-3 7", "m17 13-3 7"],
        ["cloud-lightning"] = ["M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973", "m13 12-3 5h4l-3 5"],
    };

    public static IEnumerable<string> Keys => Data.Keys;

    /// <summary>A 24-unit box scaled to <c>glyph</c> (16 DIP) with a rendered stroke of 1.5 DIP, round caps and joins.</summary>
    public static FrameworkElement Build(string? icon, string brush)
    {
        var group = new GeometryGroup();
        foreach (var d in Data[Copy.GlyphKey(icon)]) group.Children.Add(Geometry.Parse(d));
        var path = new System.Windows.Shapes.Path
        {
            Data = group,
            Stroke = Theme.B(brush),
            StrokeThickness = 1.5 * 24 / Theme.D("glyph"),
            StrokeStartLineCap = PenLineCap.Round,
            StrokeEndLineCap = PenLineCap.Round,
            StrokeLineJoin = PenLineJoin.Round,
        };
        var box = new Canvas { Width = 24, Height = 24, Children = { path } };
        return new Viewbox { Width = Theme.D("glyph"), Height = Theme.D("glyph"), Stretch = Stretch.Uniform, Child = box };
    }
}
