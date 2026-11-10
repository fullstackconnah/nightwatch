namespace NightwatchDesk.Core;

public readonly record struct Box(double Left, double Top, double Width, double Height)
{
    public double Right => Left + Width;
    public double Bottom => Top + Height;
    public bool Overlaps(Box o) => Left < o.Right && o.Left < Right && Top < o.Bottom && o.Top < Bottom;
    public bool Contains(Box o) => o.Left >= Left && o.Right <= Right && o.Top >= Top && o.Bottom <= Bottom;
}

public static class Placement
{
    /// <summary>Top-right of the primary work area, inset from the top and right edges.</summary>
    public static Box Default(Box primary, double width, double height, double inset) =>
        new(primary.Right - inset - width, primary.Top + inset, width, height);

    /// <summary>
    /// Keeps the window fully on screen: unchanged when inside a work area, else clamped into the work area it
    /// overlaps most, else the default position.
    /// </summary>
    public static Box Clamp(Box win, IReadOnlyList<Box> workAreas, Box primary, double inset)
    {
        if (workAreas.Any(w => w.Contains(win))) return win;
        var target = workAreas.Where(w => w.Overlaps(win))
            .OrderByDescending(w => Math.Max(0, Math.Min(w.Right, win.Right) - Math.Max(w.Left, win.Left)) * Math.Max(0, Math.Min(w.Bottom, win.Bottom) - Math.Max(w.Top, win.Top)))
            .Select(w => (Box?)w).FirstOrDefault();
        if (target is not { } t) return Default(primary, win.Width, win.Height, inset);
        return win with
        {
            Left = Math.Max(t.Left, Math.Min(win.Left, t.Right - win.Width)),
            Top = Math.Max(t.Top, Math.Min(win.Top, t.Bottom - win.Height)),
        };
    }

    /// <summary>True when the window's top sits in the upper half of its work area, so it keeps its top edge and grows down.</summary>
    public static bool GrowsDown(Box win, Box work) => win.Top < work.Top + work.Height / 2;
}
