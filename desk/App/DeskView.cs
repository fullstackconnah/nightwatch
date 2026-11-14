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
/// <remarks>Now is the clock the TODAY header shows (null: the real time), so a capture is fixed. Closed holds the section ids the user closed; an unknown id is ignored.
/// WorkHeight is the monitor's work-area height in DIP (infinity: no fit-fold); every section folds against it, with or without the camera.</remarks>
internal sealed record Model(View Committed, View Latest, bool UpdateHeld, bool Hover1 = false, bool Focus1 = false, Strip? Weather = null, Cam? Camera = null, DateTimeOffset? Now = null, string[]? Closed = null, double WorkHeight = double.PositiveInfinity);

/// <summary>The weather strip and the forecast under it; null on the model means TODAY shows its header only. Dim: the last values, temperature and glyph quieter.</summary>
internal sealed record Strip(WeatherNow Weather, bool Dim, ForecastDay[]? Forecast = null);

/// <summary>The camera block; null on the model means hidden.</summary>
internal sealed record Cam(bool Collapsed, FrameState State, System.Windows.Media.ImageSource? Image, DateTimeOffset? FrameAt, bool HoverFrame = false, bool FocusHeader = false, bool Live = false, bool FocusLive = false);

/// <summary>One header for every section (SHAPE "Sections"): a RowButton of more-height, the label on the left, the meta and the chevron on the right.
/// It also reports ExpandCollapse to screen readers. Collapsible false (TODAY with no weather): a plain Text element, no button, no tab stop, same height.</summary>
internal sealed class SectionHeader : Button
{
    public bool Expanded { get; set; }
    public TextBlock Label { get; }
    public TextBlock Meta { get; }
    public FrameworkElement Chevron { get; }

    bool collapsible = true;
    public bool Collapsible
    {
        get => collapsible;
        set { collapsible = value; Focusable = IsTabStop = IsHitTestVisible = value; }
    }

    /// <param name="id">Gives the automation ids {id}-header, {id}-label, {id}-meta and {id}-chevron.</param>
    /// <param name="rightMargin">The camera leaves sp-base for the Watch live button; the other sections use the panel side.</param>
    public SectionHeader(string id, string label, double rightMargin)
    {
        Label = Theme.Text(label, "fs-label", "lh-label", "ink-faint", semibold: true);
        Label.VerticalAlignment = VerticalAlignment.Center;
        Label.Margin = new Thickness(0, 0, Theme.D("sp-base"), 0); // the label trims before it reaches the meta
        Meta = Theme.Text("", "fs-note", "lh-note", "ink-dim", mono: true);
        Meta.VerticalAlignment = VerticalAlignment.Center;
        Chevron = DeskView.NewChevron();
        Chevron.VerticalAlignment = VerticalAlignment.Center;
        Chevron.RenderTransformOrigin = new Point(.5, .5);
        Chevron.Margin = new Thickness(Theme.D("sp-base"), 0, 0, 0);
        var right = new StackPanel { Orientation = Orientation.Horizontal, Children = { Meta, Chevron } };
        Grid.SetColumn(right, 1);
        var side = Theme.D("sp-lg") - Theme.D("hairline");
        var grid = new Grid { Margin = new Thickness(side, 0, rightMargin, 0) };
        grid.ColumnDefinitions.Add(new ColumnDefinition());
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.Children.Add(Label);
        grid.Children.Add(right);
        Style = (Style)Application.Current.Resources["RowButton"];
        Height = Theme.D("more-height");
        Content = grid;
        AutomationProperties.SetAutomationId(this, id + "-header");
        AutomationProperties.SetAutomationId(Label, id + "-label");
        AutomationProperties.SetAutomationId(Meta, id + "-meta");
        AutomationProperties.SetAutomationId(Chevron, id + "-chevron");
    }

    protected override System.Windows.Automation.Peers.AutomationPeer OnCreateAutomationPeer() => new Peer(this);

    sealed class Peer(SectionHeader h) : System.Windows.Automation.Peers.ButtonAutomationPeer(h), System.Windows.Automation.Provider.IExpandCollapseProvider
    {
        public override object? GetPattern(System.Windows.Automation.Peers.PatternInterface p) =>
            !h.Collapsible ? (p is System.Windows.Automation.Peers.PatternInterface.ExpandCollapse or System.Windows.Automation.Peers.PatternInterface.Invoke ? null : base.GetPattern(p))
            : p == System.Windows.Automation.Peers.PatternInterface.ExpandCollapse ? this : base.GetPattern(p);
        protected override System.Windows.Automation.Peers.AutomationControlType GetAutomationControlTypeCore() =>
            h.Collapsible ? System.Windows.Automation.Peers.AutomationControlType.Button : System.Windows.Automation.Peers.AutomationControlType.Text;
        public System.Windows.Automation.ExpandCollapseState ExpandCollapseState =>
            h.Expanded ? System.Windows.Automation.ExpandCollapseState.Expanded : System.Windows.Automation.ExpandCollapseState.Collapsed;
        public void Expand() { if (!h.Expanded) h.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent)); }
        public void Collapse() { if (h.Expanded) h.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent)); }
    }
}

/// <summary>The Watch live button: a button that reports Toggle (on or off) to screen readers.</summary>
internal sealed class LiveButton : Button
{
    public bool On { get; set; }
    protected override System.Windows.Automation.Peers.AutomationPeer OnCreateAutomationPeer() => new Peer(this);

    sealed class Peer(LiveButton b) : System.Windows.Automation.Peers.ButtonAutomationPeer(b), System.Windows.Automation.Provider.IToggleProvider
    {
        public override object? GetPattern(System.Windows.Automation.Peers.PatternInterface p) =>
            p == System.Windows.Automation.Peers.PatternInterface.Toggle ? this : base.GetPattern(p);
        public System.Windows.Automation.ToggleState ToggleState => b.On ? System.Windows.Automation.ToggleState.On : System.Windows.Automation.ToggleState.Off;
        public void Toggle() => b.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
    }
}

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
    string? bodyKey, vitalsKey, footerKey, weatherKey, todayKey, foldKey;
    (bool Cam, bool Media, bool Today) foldValue;
    Mark? lastMark;
    HashSet<string> shown = new();

    // TODAY: hairline, the header (always shown, the clock lives in it), then the body (the weather strip and the forecast row).
    readonly StackPanel todayBox = new();
    readonly StackPanel todayBody = new() { Visibility = Visibility.Collapsed };
    readonly StackPanel camBox = new() { Visibility = Visibility.Collapsed };
    readonly StackPanel mediaBox = new() { Visibility = Visibility.Collapsed };
    readonly Button camFrame = new();
    readonly Image frameImage = new();
    // Built in the constructor and BuildCamera: they read tokens, which load first.
    SectionHeader todayHeader = null!, camHeader = null!;
    TextBlock frameMsg1 = null!, frameMsg2 = null!, camLiveText = null!;
    readonly LiveButton camLive = new();
    Ellipse camDot = null!;
    Grid camContent = null!;
    bool frameIsLive;

    /// <summary>Called with a relative href ("/..."); the host prefixes the base address.</summary>
    public Action<string>? Open;
    /// <summary>The camera header was clicked; the host flips and saves the collapsed flag.</summary>
    public Action? CameraToggled;
    /// <summary>The Watch live button was clicked; the host starts or ends Live.</summary>
    public Action? CameraLiveToggled;
    /// <summary>A section header was clicked (today raises "today"); the host flips and saves it. The camera keeps CameraToggled.</summary>
    public Action<string>? SectionToggled;
    /// <summary>True while the camera block is showing only its header because the screen is too short (a view state, never saved).</summary>
    public bool CameraFolded { get; private set; }
    /// <summary>The same for the TODAY body.</summary>
    public bool TodayFolded { get; private set; }

    public Button CameraHeaderButton => camHeader;
    public Button CameraLiveButton => camLive;
    public Button CameraFrameButton => camFrame;

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
        answer.Height = 2 * lh + 1; // +1 DIP: the slot is arranged on whole device pixels, and at 150% 46.8 rounds down to 46.67, which trimmed line 2 to an ellipsis on line 1
        answer.VerticalAlignment = VerticalAlignment.Top;
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
        todayHeader = new SectionHeader("today", "", side);
        todayHeader.Click += (_, _) => SectionToggled?.Invoke("today");
        todayBox.Children.Add(Hairline());
        todayBox.Children.Add(todayHeader);
        todayBox.Children.Add(todayBody);
        AutomationProperties.SetAutomationId(todayBox, "today-block");
        stack.Children.Add(todayBox);
        BuildCamera(side);
        stack.Children.Add(camBox);
        stack.Children.Add(mediaBox);
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
        vk += "|" + dim;
        if (vk != vitalsKey) { vitalsKey = vk; FillVitals(vg?.Vitals, dim); }

        var f = Copy.Footer(m.Latest, tz) ?? "";
        if (f != footerKey)
        {
            footerKey = f;
            footer.Inlines.Clear();
            AddClockRuns(footer, f);
        }
        footer.Foreground = Theme.B(m.Latest is View.Stale or View.Offline or View.WrongToken or View.DeskOff ? "warn" : "ink-dim");
        held.Visibility = m.UpdateHeld ? Visibility.Visible : Visibility.Hidden;

        var now = m.Now ?? DateTimeOffset.Now;
        var closed = m.Closed?.Contains("today") == true;
        var forecast = ForecastDay.Usable(m.Weather?.Forecast);
        var rows = m.Weather is null || closed ? 0 : forecast.Length > 0 ? 2 : 1; // strip, then forecast row
        (CameraFolded, _, TodayFolded) = Folds(m.WorkHeight, m.Camera, 0, rows);
        RenderToday(m.Weather, forecast, now, asOf, closed);
        FillCamera(m.Camera, m.Latest is View.Stale or View.Offline);
    }

    // --- TODAY (SHAPE "TODAY"): the header IS the clock row; the body is the weather strip and the forecast row ---
    void RenderToday(Strip? s, ForecastDay[] forecast, DateTimeOffset now, string? asOf, bool closed)
    {
        var folded = TodayFolded;
        var open = s is not null && !closed && !folded;
        var hkey = $"{Copy.TodayDate(now, tz)}|{Copy.Clock(now, tz)}|{closed}|{folded}|{asOf}|{s?.Dim}|{(s is null ? "" : Copy.WeatherTemp(s.Weather))}";
        if (hkey != todayKey)
        {
            todayKey = hkey;
            todayHeader.Label.Text = Copy.TodayDate(now, tz) + (asOf is null ? "" : " · " + asOf.ToUpperInvariant());
            AutomationProperties.SetName(todayHeader, Copy.TodayName(now, tz));
            todayHeader.Meta.Inlines.Clear();
            // The clock never dims; the temperature after it shows only while the body is not.
            todayHeader.Meta.Inlines.Add(new Run(Copy.Clock(now, tz)) { FontSize = Theme.D("fs-title"), Foreground = Theme.B("ink") });
            if (s is not null && (closed || folded))
                todayHeader.Meta.Inlines.Add(new Run(" · " + Copy.WeatherTemp(s.Weather)) { Foreground = Theme.B(folded ? "ink-faint" : s.Dim ? "ink-dim" : "ink") });
        }
        todayHeader.Collapsible = s is not null;
        todayHeader.Expanded = open;
        todayHeader.IsEnabled = !folded;
        todayHeader.Cursor = folded || s is null ? System.Windows.Input.Cursors.Arrow : System.Windows.Input.Cursors.Hand;
        todayHeader.ToolTip = s is null ? null : Copy.TodayHeaderTip(closed, folded);
        todayHeader.Chevron.Visibility = s is null || folded ? Visibility.Collapsed : Visibility.Visible;
        todayHeader.Chevron.RenderTransform = new RotateTransform(open ? 90 : 0); // points right when closed, down when open; snaps

        // A changed forecast must repaint: a record prints an array as its type name, so the key joins the days.
        var key = s is null ? "" : s + "|" + string.Join("|", forecast.Select(d => d.ToString()));
        if (key != weatherKey)
        {
            weatherKey = key;
            todayBody.Children.Clear();
            if (s is not null)
            {
                todayBody.Children.Add(StripRow(s));
                if (forecast.Length > 0) todayBody.Children.Add(ForecastRow(forecast, s.Dim));
            }
        }
        todayBody.Visibility = open ? Visibility.Visible : Visibility.Collapsed;
    }

    // --- weather strip (SHAPE 2): two lines in the row shape, not interactive, not a tab stop ---
    FrameworkElement StripRow(Strip s)
    {
        var w = s.Weather;
        var side = Theme.D("sp-lg") - Theme.D("hairline");
        var l1 = Theme.Text("", "fs-title", "lh-title", "ink-dim");
        l1.Inlines.Add(new Run(Copy.WeatherTemp(w)) { FontFamily = Theme.F("font-mono"), FontSize = Theme.D("fs-title"), Foreground = Theme.B(s.Dim ? "ink-dim" : "ink") });
        l1.Inlines.Add(new Run("  " + Copy.WeatherLabel(w)) { FontSize = Theme.D("fs-body") });
        var l2 = Theme.Text(Copy.WeatherLine2(w), "fs-note", "lh-note", "ink-dim", mono: true);
        l2.Height = Theme.D("lh-note"); // an empty line 2 still holds its place
        l2.Margin = new Thickness(0, Theme.D("sp-hair"), 0, 0);
        var text = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Children = { l1, l2 } };
        Grid.SetColumn(text, 2);

        var glyph = WeatherGlyph.Build(w.Icon, s.Dim ? "ink-faint" : "ink-dim");
        var lines = Theme.D("lh-title") + Theme.D("sp-hair") + Theme.D("lh-note");
        glyph.VerticalAlignment = VerticalAlignment.Top;
        glyph.HorizontalAlignment = HorizontalAlignment.Left;
        glyph.Margin = new Thickness(0, (Theme.D("row-height") - lines) / 2 + (Theme.D("lh-title") - Theme.D("glyph")) / 2, 0, 0); // centred on line 1

        var strip = new Grid { Height = Theme.D("row-height"), Margin = new Thickness(side, 0, side, 0), Background = Brushes.Transparent };
        strip.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Theme.D("glyph")) });
        strip.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Theme.D("sp-sm")) });
        strip.ColumnDefinitions.Add(new ColumnDefinition());
        strip.Children.Add(glyph);
        strip.Children.Add(text);
        var tip = Copy.WeatherTooltip(w);
        strip.ToolTip = tip;
        AutomationProperties.SetName(strip, tip);
        AutomationProperties.SetAutomationId(strip, "weather");
        return strip;
    }

    /// <summary>The next days (at most 4) in columns of frame-w / 4, left-aligned; fewer days leave blank slots. Day name over glyph, high and low; the low drops when it does not fit its column.</summary>
    FrameworkElement ForecastRow(ForecastDay[] days, bool dim)
    {
        var side = Theme.D("sp-lg") - Theme.D("hairline");
        var col = Theme.D("frame-w") / 4;
        var row = new Grid { Height = Theme.D("row-height"), Width = Theme.D("frame-w"), HorizontalAlignment = HorizontalAlignment.Left, Margin = new Thickness(side, 0, side, 0) };
        for (var i = 0; i < 4; i++) row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(col) });
        for (var i = 0; i < days.Length; i++)
        {
            var d = days[i];
            var name = Theme.Text(Copy.ForecastDayName(d.Day)!, "fs-label", "lh-label", "ink-faint", semibold: true);
            var high = Theme.Text(Copy.Degrees(d.HighC), "fs-note", "lh-note", dim ? "ink-dim" : "ink", mono: true);
            var low = Theme.Text(" " + Copy.Degrees(d.LowC), "fs-note", "lh-note", "ink-dim", mono: true);
            var glyph = WeatherGlyph.Build(d.Icon, dim ? "ink-faint" : "ink-dim");
            glyph.VerticalAlignment = VerticalAlignment.Center;
            glyph.Margin = new Thickness(0, 0, Theme.D("sp-xs"), 0);
            var line2 = new StackPanel { Orientation = Orientation.Horizontal, Children = { glyph, high, low } };
            line2.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
            if (line2.DesiredSize.Width > col) low.Visibility = Visibility.Collapsed; // shortcut: measured once when built, not on a later DPI change; a clipped low would ellipsise, never overlap
            var cell = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Background = Brushes.Transparent, Children = { name, line2 } };
            var tip = Copy.ForecastTooltip(d)!;
            cell.ToolTip = tip;
            AutomationProperties.SetName(cell, tip);
            AutomationProperties.SetAutomationId(cell, "forecast-day");
            Grid.SetColumn(cell, i);
            row.Children.Add(cell);
        }
        AutomationProperties.SetAutomationId(row, "forecast");
        return row;
    }

    // --- camera block (SHAPE 3) ---
    void BuildCamera(double side)
    {
        // The live button sits to the right of the toggle, so the toggle's right edge is sp-base from the chevron, not the panel side.
        camHeader = new SectionHeader("camera", Copy.CameraTitle.ToUpperInvariant(), Theme.D("sp-base"));
        AutomationProperties.SetName(camHeader, Copy.CameraHeaderName);
        camHeader.Click += (_, _) => CameraToggled?.Invoke();

        // Watch live: its own button, never nested in the toggle. Off: "Watch live" (ink-dim). On: an accent dot and "Live" (ink).
        camDot = new Ellipse { Width = Theme.D("dot"), Height = Theme.D("dot"), Fill = Theme.B("accent"), VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, Theme.D("sp-xs"), 0), Visibility = Visibility.Collapsed };
        camLiveText = Theme.Text(Copy.CameraWatchLive, "fs-note", "lh-note", "ink-dim");
        camLiveText.VerticalAlignment = VerticalAlignment.Center;
        camLiveText.TextTrimming = TextTrimming.CharacterEllipsis;
        var liveContent = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(Theme.D("sp-base"), 0, Theme.D("sp-base"), 0), Children = { camDot, camLiveText } };
        camLive.Style = (Style)Application.Current.Resources["RowButton"];
        camLive.Height = Theme.D("more-height");
        camLive.Content = liveContent;
        camLive.ToolTip = Copy.CameraLiveTip(false);
        AutomationProperties.SetAutomationId(camLive, "camera-live-button");
        AutomationProperties.SetName(camLive, Copy.CameraLiveName);
        camLive.Click += (_, _) => CameraLiveToggled?.Invoke();
        Grid.SetColumn(camLive, 1);
        var camRow = new Grid();
        camRow.ColumnDefinitions.Add(new ColumnDefinition());
        camRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        camRow.Children.Add(camHeader);
        camRow.Children.Add(camLive);
        AutomationProperties.SetAutomationId(camBox, "camera-block");

        var w = Theme.D("frame-w"); var h = Theme.D("frame-h");
        frameImage.Stretch = Stretch.Uniform;
        RenderOptions.SetBitmapScalingMode(frameImage, BitmapScalingMode.HighQuality);
        frameMsg1 = Theme.Text("", "fs-body", "lh-body", "ink-dim");
        frameMsg2 = Theme.Text("", "fs-note", "lh-note", "ink-faint", mono: true);
        frameMsg1.TextAlignment = TextAlignment.Center;
        frameMsg2.TextAlignment = TextAlignment.Center;
        frameMsg2.Margin = new Thickness(0, Theme.D("sp-xs"), 0, 0);
        var msg = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Children = { frameMsg1, frameMsg2 } };
        var content = camContent = new Grid
        {
            Width = w, Height = h, Background = Theme.B("bg"), Children = { frameImage, msg },
            Clip = new RectangleGeometry(new Rect(0, 0, w, h), Theme.D("r-md"), Theme.D("r-md")),
        };
        camFrame.Style = (Style)Application.Current.Resources["FrameButton"];
        camFrame.Width = w; camFrame.Height = h;
        camFrame.HorizontalAlignment = HorizontalAlignment.Left;
        camFrame.Margin = new Thickness(side, 0, side, Theme.D("sp-md"));
        camFrame.Content = content;
        camFrame.ToolTip = Copy.CameraFrameTip;
        AutomationProperties.SetAutomationId(camFrame, "camera-frame");
        camFrame.Click += (_, _) => Open?.Invoke("/kiosk?door=1");

        camBox.Children.Add(Hairline());
        camBox.Children.Add(camRow);
        camBox.Children.Add(camFrame);
    }

    /// <summary>The open block: the still (207) or Live, full bleed with no bottom margin (212).</summary>
    static double OpenCameraHeight(bool live) => live
        ? Theme.D("hairline") + Theme.D("more-height") + Theme.D("frame-live-h")
        : Theme.D("hairline") + Theme.D("more-height") + Theme.D("frame-h") + Theme.D("sp-md");

    /// <summary>The still frame (288 x 162, rounded, inset by the panel side) or the Live frame (318 x 179, full bleed, square). The picture and the line over it are sized together.</summary>
    void SizeFrame(bool live)
    {
        if (live == frameIsLive) return;
        frameIsLive = live;
        var w = Theme.D(live ? "frame-live-w" : "frame-w"); var h = Theme.D(live ? "frame-live-h" : "frame-h");
        var side = Theme.D("sp-lg") - Theme.D("hairline");
        camContent.Width = w; camContent.Height = h;
        camContent.Clip = live ? null : new RectangleGeometry(new Rect(0, 0, w, h), Theme.D("r-md"), Theme.D("r-md"));
        camFrame.Style = (Style)Application.Current.Resources[live ? "FrameButtonLive" : "FrameButton"];
        camFrame.Width = w; camFrame.Height = h;
        camFrame.Margin = live ? new Thickness(0) : new Thickness(side, 0, side, Theme.D("sp-md"));
        camFrame.ToolTip = live ? Copy.CameraLiveFrameTip : Copy.CameraFrameTip;
    }

    /// <summary>How many times Folds measured the tree. A cached answer or an early return never counts (a clock-only render must not probe).</summary>
    public int FoldProbes { get; private set; }

    /// <summary>Which open parts do not fit the work area less sp-lg (SHAPE "Fold rule"), folding one at a time: the camera first, then MEDIA, then TODAY. While Live is on the camera
    /// goes last, so MEDIA and TODAY fold first and Live ends only if it still does not fit. Measured without the camera block and the MEDIA and TODAY bodies, so it never depends on their own state.
    /// No work height (infinity) or nothing foldable answers all false without measuring; the key still records it so a later finite height never reuses a stale answer.</summary>
    (bool Cam, bool Media, bool Today) Folds(double work, Cam? c, double mediaH, int todayRows)
    {
        var key = $"{bodyKey}|{vitalsBox.Visibility}|{work}|{c is null}|{c?.Live}|{c?.Collapsed}|{todayRows}|{mediaBox.Visibility}|{mediaH}";
        if (key == foldKey) return foldValue;
        foldKey = key;
        if (double.IsPositiveInfinity(work) || (c is null && mediaH == 0 && todayRows == 0)) return foldValue = (false, false, false);
        FoldProbes++;
        camBox.Visibility = Visibility.Collapsed;
        todayBody.Visibility = Visibility.Collapsed;
        Stale(this); // a laid-out tree would answer from its cache and still count the blocks just collapsed
        Measure(new Size(Width, double.PositiveInfinity));
        var baseHeight = DesiredSize.Height;
        Stale(this); // the probe left every cached size short of the blocks; the next layout pass measures it all again
        var limit = work - Theme.D("sp-lg");
        var head = Theme.D("hairline") + Theme.D("more-height");
        var live = c?.Live == true;
        bool cam = false, media = false, today = false;
        double Total() => baseHeight + (c is null ? 0 : c.Collapsed || cam ? head : OpenCameraHeight(live)) + (media ? 0 : mediaH) + (today ? 0 : todayRows * Theme.D("row-height"));
        foreach (var part in live ? new[] { "media", "today", "cam" } : new[] { "cam", "media", "today" })
        {
            if (Total() <= limit) break;
            if (part == "cam" && c is { Collapsed: false }) cam = true;
            else if (part == "media" && mediaH > 0) media = true;
            else if (part == "today" && todayRows > 0) today = true;
        }
        return foldValue = (cam, media, today);
    }

    static void Stale(DependencyObject o)
    {
        (o as UIElement)?.InvalidateMeasure();
        for (var i = 0; o is Visual && i < VisualTreeHelper.GetChildrenCount(o); i++) Stale(VisualTreeHelper.GetChild(o, i));
    }

    void FillCamera(Cam? c, bool boxDown)
    {
        if (c is null) { camBox.Visibility = Visibility.Collapsed; return; }
        var folded = CameraFolded;
        var open = !c.Collapsed && !folded;
        camBox.Visibility = Visibility.Visible;

        camHeader.Expanded = open;
        camHeader.IsEnabled = !folded;
        camHeader.Cursor = folded ? System.Windows.Input.Cursors.Arrow : System.Windows.Input.Cursors.Hand;
        camHeader.ToolTip = Copy.CameraHeaderTip(c.Collapsed, folded);
        camHeader.Chevron.Visibility = folded ? Visibility.Collapsed : Visibility.Visible;
        camHeader.Chevron.RenderTransform = new RotateTransform(open ? 90 : 0); // points right when closed, down when open; snaps
        Snap.SetForceFocus(camHeader, c.FocusHeader);

        var live = open && c.Live;
        camLive.On = live;
        camLive.IsEnabled = !folded;
        camLive.Cursor = folded ? System.Windows.Input.Cursors.Arrow : System.Windows.Input.Cursors.Hand;
        camLive.ToolTip = Copy.CameraLiveTip(live);
        camDot.Visibility = live ? Visibility.Visible : Visibility.Collapsed;
        camLiveText.Text = live ? Copy.CameraLiveOn : Copy.CameraWatchLive;
        camLiveText.Foreground = Theme.B(folded ? "ink-faint" : live ? "ink" : "ink-dim");
        Snap.SetForceFocus(camLive, c.FocusLive);
        SizeFrame(live);

        var shown = open && c.State is FrameState.Live or FrameState.Stale && c.FrameAt is not null;
        var at = c.FrameAt is { } t ? TimeZoneInfo.ConvertTime(t, tz).DateTime : (DateTime?)null;
        // Live and fresh: the dot already says so, so the meta is empty; stale: the age, as in the still.
        var camAge = camHeader.Meta;
        camAge.Text = folded ? Copy.CameraFolded : open && shown && !(live && c.State == FrameState.Live) ? Copy.FrameAge(at!.Value) : "";
        camAge.FontFamily = Theme.F(folded ? "font-sans" : "font-mono");
        camAge.Foreground = Theme.B(folded ? "ink-faint" : c.State == FrameState.Stale && !boxDown ? "warn" : "ink-dim"); // the box line already speaks in warn when the box is down

        var frameHadFocus = camFrame.IsKeyboardFocusWithin;
        camFrame.Visibility = open ? Visibility.Visible : Visibility.Collapsed;
        if (frameHadFocus && !open && camLive.IsEnabled) camLive.Focus(); // a hidden frame must not strand the keyboard focus
        Snap.SetForceHover(camFrame, c.HoverFrame);
        AutomationProperties.SetName(camFrame, Copy.CameraFrameName(c.State, at));
        frameImage.Source = open && c.State is FrameState.Live or FrameState.Stale ? c.Image : null;
        frameImage.Opacity = c.State == FrameState.Stale ? Theme.D("frame-dim") : 1;
        frameMsg1.Text = c.State switch { FrameState.Loading => Copy.CameraLoading, FrameState.NoPicture => Copy.CameraNoPicture, _ => "" };
        frameMsg2.Text = c.State == FrameState.NoPicture ? Copy.CameraLastFrame(at) : "";
        frameMsg2.Visibility = frameMsg2.Text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        frameMsg1.Visibility = frameMsg1.Text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
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
        var chev = NewChevron();
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
        var c = NewChevron();
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

    void FillVitals(Vitals? v, bool dim)
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
            vitals.Inlines.Add(new Run(caption + " ") { Foreground = Theme.B(dim ? "ink-dim" : "ink-faint"), FontSize = Theme.D("fs-label"), FontWeight = FontWeights.SemiBold });
            vitals.Inlines.Add(new Run(value) { Foreground = Theme.B(dim ? "ink-dim" : "ink"), FontFamily = Theme.F("font-mono"), FontSize = Theme.D("fs-data") });
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

    internal static System.Windows.Shapes.Path NewChevron() => new()
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
