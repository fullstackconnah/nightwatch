using System.Globalization;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Shapes;
using NightwatchDesk.Core;

namespace NightwatchDesk.App;

internal enum Mark { None, Ring, Amber, Red, Off }

/// <summary>What to draw: the committed body, the newest view (footer, vitals and the dim restyle read it), and the gate's flag.</summary>
internal sealed record Model(View Committed, View Latest, bool UpdateHeld, bool Hover1 = false, bool Focus1 = false);

/// <summary>The one panel column (SHAPE "Layout"). Built in code from Tokens.xaml; every size comes from a token.</summary>
internal sealed class DeskView : Border
{
    public const int MaxRows = 3;
    static readonly Regex Clock = new(@"\d{2}:\d{2}", RegexOptions.Compiled);

    readonly TimeZoneInfo tz;
    readonly Border markSlot;
    readonly TextBlock answer;
    readonly StackPanel body = new();
    readonly StackPanel vitalsBox = new();
    readonly TextBlock vitals;
    readonly TextBlock footer;
    readonly TextBlock held;
    string? bodyKey, vitalsKey, footerKey;
    Mark? lastMark;
    HashSet<string> shown = new();

    /// <summary>Called with a relative href ("/..."); the host prefixes the base address.</summary>
    public Action<string>? Open;

    public DeskView(TimeZoneInfo tz)
    {
        this.tz = tz;
        Theme.EnsureLoaded();
        Width = Theme.D("win-width");
        Background = Theme.B("panel");
        BorderBrush = Theme.B("line");
        BorderThickness = new Thickness(Theme.D("hairline"));
        CornerRadius = new CornerRadius(Theme.D("r-panel"));
        UseLayoutRounding = true;
        SnapsToDevicePixels = true;
        TextOptions.SetTextFormattingMode(this, TextFormattingMode.Display);
        AutomationProperties.SetName(this, "Nightwatch Desk");

        var side = Theme.D("sp-lg") - Theme.D("hairline"); // the 1 DIP border sits inside the 16 DIP side padding, so content is 288 wide

        // Head: mark slot, gap, a fixed two-line answer.
        var lh = Theme.D("lh-headline");
        markSlot = new Border { Width = Theme.D("dot"), Height = Theme.D("dot"), VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, (lh - Theme.D("dot")) / 2, 0, 0) };
        answer = Theme.Text("", "fs-headline", "lh-headline", "ink", semibold: true, wrap: true);
        answer.TextTrimming = TextTrimming.CharacterEllipsis;
        answer.MaxHeight = 2 * lh + 1; // +1: layout rounding at 150% must not trim the second line
        AutomationProperties.SetLiveSetting(answer, AutomationLiveSetting.Polite);
        var answerBox = new Grid { Height = 2 * lh, ClipToBounds = true, Children = { answer } };
        var head = new Grid { Margin = new Thickness(side, Theme.D("sp-lg"), side, Theme.D("sp-md")) };
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Theme.D("dot")) });
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Theme.D("gap-answer")) });
        head.ColumnDefinitions.Add(new ColumnDefinition());
        head.Children.Add(markSlot);
        Grid.SetColumn(answerBox, 2);
        head.Children.Add(answerBox);
        AutomationProperties.SetAutomationId(head, "head");

        // Vitals: a hairline, then one mono line.
        vitals = Theme.Text("", "fs-data", "lh-data", "ink-dim");
        vitals.Margin = new Thickness(side, Theme.D("sp-md"), side, Theme.D("sp-md"));
        AutomationProperties.SetAutomationId(vitals, "vitals");
        vitalsBox.Children.Add(Hairline());
        vitalsBox.Children.Add(vitals);

        // Footer: the freshness line, and a reserved slot for "update held".
        footer = Theme.Text("", "fs-note", "lh-note", "ink-dim");
        held = Theme.Text("UPDATE HELD", "fs-label", "lh-label", "warn", semibold: true);
        held.VerticalAlignment = VerticalAlignment.Center;
        held.Visibility = Visibility.Hidden; // Hidden, never Collapsed: the slot stays reserved
        var foot = new Grid { Margin = new Thickness(side, Theme.D("sp-xs"), side, Theme.D("sp-lg")) };
        foot.ColumnDefinitions.Add(new ColumnDefinition());
        foot.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        foot.Children.Add(footer);
        Grid.SetColumn(held, 1);
        foot.Children.Add(held);
        AutomationProperties.SetAutomationId(foot, "footer");

        var stack = new StackPanel();
        stack.Children.Add(head);
        stack.Children.Add(body);
        stack.Children.Add(vitalsBox);
        stack.Children.Add(foot);

        // The panel's lit top edge, inset so it clears the rounded corners.
        var lit = new Border { Height = Theme.D("hairline"), VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(Theme.D("r-panel"), 0, Theme.D("r-panel"), 0), Background = Theme.B("panel-lit"), IsHitTestVisible = false };
        Child = new Grid { Children = { stack, lit } };
    }

    public Button? FirstRow => FindRows().FirstOrDefault();

    IEnumerable<Button> FindRows() => body.Children.OfType<Button>();

    public static Glance? GlanceOf(View v) => v switch
    {
        View.Live l => l.Glance,
        View.Stale s => s.Glance,
        View.Offline o => o.Glance,
        _ => null,
    };

    static Mark MarkOf(View v, bool dim) => dim ? Mark.Off : v switch
    {
        View.FirstLaunch => Mark.Ring,
        View.Live l => l.Glance.Tone switch { "ok" => Mark.None, "pending" => Mark.Ring, "bad" => Mark.Red, _ => Mark.Amber },
        View.Stale or View.Offline => Mark.Off,
        _ => Mark.Amber,
    };

    public void Render(Model m, bool animate = false)
    {
        var v = m.Committed;
        var dim = m.Latest is View.Stale or View.Offline;
        var g = GlanceOf(v);

        var mark = MarkOf(v, dim);
        if (mark != lastMark) { lastMark = mark; markSlot.Child = MarkShape(mark); }
        var headText = Copy.Head(v);
        answer.Text = headText;
        answer.Foreground = Theme.B(dim ? "ink-dim" : "ink");
        answer.ToolTip = headText;
        AutomationProperties.SetName(answer, headText);

        string? asOf = dim && (m.Latest as View.Stale)?.LastSuccess is { } a ? Copy.AsOf(a, tz)
            : dim && (m.Latest as View.Offline)?.LastSuccess is { } b ? Copy.AsOf(b, tz) : null;
        var key = $"{Gate.Sig(v)}|{dim}|{asOf}|{m.Hover1}|{m.Focus1}";
        if (key != bodyKey)
        {
            bodyKey = key;
            RebuildBody(v, g, dim, asOf, m, animate);
        }

        var vg = GlanceOf(m.Latest) ?? g;
        vitalsBox.Visibility = g is null ? Visibility.Collapsed : Visibility.Visible;
        var vk = vg?.Vitals?.ToString() ?? "none";
        if (vk != vitalsKey) { vitalsKey = vk; FillVitals(vg?.Vitals); }

        var f = Copy.Footer(m.Latest, tz) ?? "";
        if (f != footerKey)
        {
            footerKey = f;
            footer.Inlines.Clear();
            AddClockRuns(footer, f);
        }
        footer.Foreground = Theme.B(m.Latest is View.Stale or View.Offline or View.WrongToken or View.DeskOff ? "warn" : "ink-dim");
        held.Visibility = m.UpdateHeld ? Visibility.Visible : Visibility.Hidden;
    }

    void RebuildBody(View v, Glance? g, bool dim, string? asOf, Model m, bool animate)
    {
        var refocus = body.IsKeyboardFocusWithin ? FindRows().ToList().FindIndex(r => r.IsKeyboardFocused) : -1;
        body.Children.Clear();
        var now = new HashSet<string>();
        var rowIndex = 0;
        var fade = animate && SystemParameters.ClientAreaAnimation;
        var side = Theme.D("sp-lg") - Theme.D("hairline");

        if (g is null)
        {
            if (Copy.Note(v) is { } note)
            {
                var t = Theme.Text(note, "fs-body", "lh-body", "ink-faint", wrap: true);
                t.Margin = new Thickness(side, 0, side, Theme.D("sp-md"));
                AutomationProperties.SetAutomationId(t, "note");
                body.Children.Add(t);
            }
        }
        else
        {
            void Section(string label, GlanceItem[] items)
            {
                if (items.Length == 0) return;
                body.Children.Add(Hairline());
                var l = Theme.Text((label + (asOf is null ? "" : " · " + asOf)).ToUpperInvariant(), "fs-label", "lh-label", "ink-faint", semibold: true);
                l.Margin = new Thickness(side, Theme.D("sp-base"), side, Theme.D("sp-xs"));
                AutomationProperties.SetAutomationId(l, "label");
                body.Children.Add(l);
                for (var i = 0; i < Math.Min(MaxRows, items.Length); i++)
                {
                    if (i > 0) body.Children.Add(Hairline());
                    var row = Row(items[i], dim, rowIndex == 0 && m.Hover1, rowIndex == 0 && m.Focus1);
                    now.Add(items[i].Id + "|" + items[i].Headline);
                    if (fade && shown.Count > 0 && !shown.Contains(items[i].Id + "|" + items[i].Headline)) row.BeginAnimation(OpacityProperty, FadeIn());
                    body.Children.Add(row);
                    rowIndex++;
                }
            }
            Section("AI lanes", g.Lanes);
            Section("Needs you", g.Items);
            var hidden = Math.Max(0, g.Lanes.Length - MaxRows) + Math.Max(0, g.Items.Length - MaxRows);
            if (hidden > 0)
            {
                body.Children.Add(Hairline());
                body.Children.Add(MoreRow(hidden));
            }
        }
        shown = now;
        if (refocus >= 0) Dispatcher.BeginInvoke((Action)(() => FindRows().ElementAtOrDefault(refocus)?.Focus()), System.Windows.Threading.DispatcherPriority.Loaded);
    }

    static AnimationTimeline FadeIn() => new DoubleAnimationUsingKeyFrames
    {
        KeyFrames =
        {
            new DiscreteDoubleKeyFrame(0, KeyTime.FromTimeSpan(TimeSpan.Zero)),
            new SplineDoubleKeyFrame(1, KeyTime.FromTimeSpan(TimeSpan.FromMilliseconds(200)), (KeySpline)Application.Current.Resources["ease-calm"]),
        },
    };

    Button Row(GlanceItem it, bool dim, bool hover, bool focus)
    {
        var side = Theme.D("sp-lg") - Theme.D("hairline");
        var content = new Grid { Margin = new Thickness(side, 0, side, 0) };
        foreach (var w in new[] { Theme.D("dot"), Theme.D("sp-md"), -1, Theme.D("sp-base"), Theme.D("chevron") })
            content.ColumnDefinitions.Add(new ColumnDefinition { Width = w < 0 ? new GridLength(1, GridUnitType.Star) : new GridLength(w) });

        var dot = MarkShape(dim ? Mark.Off : it.Severity == "bad" ? Mark.Red : Mark.Amber)!;
        dot.VerticalAlignment = VerticalAlignment.Center;
        content.Children.Add(dot);

        var l1 = Theme.Text(it.Headline, "fs-title", "lh-title", dim ? "ink-dim" : "ink", semibold: true);
        var l2 = new Grid { Height = Theme.D("lh-body"), Margin = new Thickness(0, Theme.D("sp-hair"), 0, 0) };
        l2.ColumnDefinitions.Add(new ColumnDefinition());
        l2.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        l2.Children.Add(Theme.Text(it.Detail ?? it.Action ?? "", "fs-body", "lh-body", dim ? "ink-faint" : "ink-dim"));
        var since = SinceClock(it);
        if (since is not null)
        {
            var s = Theme.Text("since " + since, "fs-note", "lh-body", dim ? "ink-faint" : "ink-dim", mono: true);
            s.Margin = new Thickness(Theme.D("sp-base"), 0, 0, 0);
            s.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(s, 1);
            l2.Children.Add(s);
        }
        var text = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Children = { l1, l2 } };
        Grid.SetColumn(text, 2);
        content.Children.Add(text);
        var chev = Chevron();
        Grid.SetColumn(chev, 4);
        chev.VerticalAlignment = VerticalAlignment.Center;
        content.Children.Add(chev);

        var b = new Button { Style = (Style)Application.Current.Resources["RowButton"], Height = Theme.D("row-height"), Content = content };
        AutomationProperties.SetAutomationId(b, "row");
        AutomationProperties.SetName(b, string.Join(" ", new[] { Dot(it.Headline), it.Detail is null ? null : Dot(it.Detail), since is null ? null : $"Since {since}.", "Opens nightwatch." }.Where(x => x is not null)));
        b.ToolTip = string.Join("\n", new[] { it.Headline, it.Detail, it.Action, since is null ? null : "Since " + since }.Where(x => !string.IsNullOrEmpty(x)));
        if (hover) Snap.SetForceHover(b, true);
        if (focus) Snap.SetForceFocus(b, true);
        b.Click += (_, _) => Open?.Invoke(Href(it.Href));
        return b;
    }

    Button MoreRow(int hidden)
    {
        var side = Theme.D("sp-lg") - Theme.D("hairline");
        var g = new Grid { Margin = new Thickness(side, 0, side, 0) };
        g.ColumnDefinitions.Add(new ColumnDefinition());
        g.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var t = Theme.Text($"+{hidden} more", "fs-body", "lh-body", "ink-dim");
        t.VerticalAlignment = VerticalAlignment.Center;
        var c = Chevron();
        c.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(c, 1);
        g.Children.Add(t);
        g.Children.Add(c);
        var b = new Button { Style = (Style)Application.Current.Resources["RowButton"], Height = Theme.D("more-height"), Content = g };
        AutomationProperties.SetAutomationId(b, "more");
        AutomationProperties.SetName(b, $"{hidden} more. Opens nightwatch.");
        b.Click += (_, _) => Open?.Invoke("/");
        return b;
    }

    static string Dot(string s) => s.EndsWith('.') ? s : s + ".";
    static string Href(string h) => h.StartsWith('/') ? h : "/";

    string? SinceClock(GlanceItem it) =>
        it.Since is { } s && DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var t) ? Copy.Clock(t, tz) : null;

    void FillVitals(Vitals? v)
    {
        vitals.Inlines.Clear();
        if (v is null)
        {
            vitals.Inlines.Add(new Run("Host vitals unavailable") { Foreground = Theme.B("ink-faint"), FontSize = Theme.D("fs-note") });
            return;
        }
        void Cap(string caption, string value, bool first)
        {
            if (!first) vitals.Inlines.Add(new Run(" · ") { Foreground = Theme.B("ink-faint") });
            vitals.Inlines.Add(new Run(caption + " ") { Foreground = Theme.B("ink-faint"), FontSize = Theme.D("fs-label"), FontWeight = FontWeights.SemiBold });
            vitals.Inlines.Add(new Run(value) { Foreground = Theme.B("ink"), FontFamily = Theme.F("font-mono"), FontSize = Theme.D("fs-data") });
        }
        Cap("CPU", $"{Math.Round(v.Cpu)}%", true);
        Cap("MEM", $"{Math.Round(v.Mem)}%", false);
        Cap("DISK", v.DiskMax is { } d ? $"{Math.Round(d)}%" : "—", false);
    }

    static void AddClockRuns(TextBlock tb, string text)
    {
        var at = 0;
        foreach (Match m in Clock.Matches(text))
        {
            if (m.Index > at) tb.Inlines.Add(new Run(text[at..m.Index]));
            tb.Inlines.Add(new Run(m.Value) { FontFamily = Theme.F("font-mono") });
            at = m.Index + m.Length;
        }
        if (at < text.Length) tb.Inlines.Add(new Run(text[at..]));
    }

    static Border Hairline()
    {
        var h = new Border { Height = Theme.D("hairline"), Background = Theme.B("line") };
        AutomationProperties.SetAutomationId(h, "hairline");
        return h;
    }

    static System.Windows.Shapes.Path Chevron() => new()
    {
        Width = Theme.D("chevron"),
        Height = Theme.D("chevron"),
        Data = Geometry.Parse("M 3.5,1.5 L 8.5,6 L 3.5,10.5"),
        Stroke = Theme.B("ink-faint"),
        StrokeThickness = 1.5,
        StrokeStartLineCap = PenLineCap.Round,
        StrokeEndLineCap = PenLineCap.Round,
        StrokeLineJoin = PenLineJoin.Round,
    };

    static FrameworkElement? MarkShape(Mark m)
    {
        if (m == Mark.None) return null;
        var e = new Ellipse { Width = Theme.D("dot"), Height = Theme.D("dot") };
        switch (m)
        {
            case Mark.Ring: e.Stroke = Theme.B("ink-faint"); e.StrokeThickness = Theme.D("hairline"); break;
            case Mark.Off: e.Fill = Theme.B("ink-faint"); break; // off should not radiate: no glow
            default:
                var warn = m == Mark.Amber;
                e.Fill = Theme.B(warn ? "warn" : "bad");
                e.Effect = new DropShadowEffect { ShadowDepth = 0, BlurRadius = 8, Opacity = .55, Color = Theme.C(warn ? "c-warn" : "c-bad") };
                break;
        }
        return e;
    }
}
