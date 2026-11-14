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
/// WorkHeight is the monitor's work-area height in DIP (infinity: no fit-fold); every section folds against it, with or without the camera.
/// History is the VITALS sparks' samples (null or under 2: "Collecting history"); the view redraws the sparks only when the array instance changes.</remarks>
internal sealed record Model(View Committed, View Latest, bool UpdateHeld, bool Hover1 = false, bool Focus1 = false, Strip? Weather = null, Cam? Camera = null, DateTimeOffset? Now = null, string[]? Closed = null, MediaNow? Media = null, double WorkHeight = double.PositiveInfinity, HomeNow? Home = null, VitalsSample[]? History = null);

/// <summary>The MEDIA block's content; null on the model means hidden. Dim: stale or offline, the last values quieter.</summary>
internal sealed record MediaNow(NowPlaying? NowPlaying, Downloads? Downloads, bool Dim);

/// <summary>The HOME block's content; null on the model means hidden. Whatever is not usable is dropped when drawing. Dim: stale or offline, the last values quieter.</summary>
internal sealed record HomeNow(Home? Home, Containers? Containers, bool Dim);

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
    static double VitalsColumn => (Theme.D("frame-w") - 2 * Theme.D("sp-md")) / 3;
    /// <summary>The VITALS body, open: the caption row, sp-xs, the spark and sp-md (54). The fold measures with it.</summary>
    static double VitalsBodyHeight => Theme.D("lh-data") + Theme.D("sp-xs") + Theme.D("spark-h") + Theme.D("sp-md");
    static readonly Regex Clock = new(@"\d{2}:\d{2}", RegexOptions.Compiled);

    readonly TimeZoneInfo tz;
    readonly Border markSlot;
    readonly TextBlock answer;
    readonly StackPanel body = new();
    readonly StackPanel vitalsBox = new();
    // VITALS: hairline, the header, then a fixed body (three captions, sparks under CPU and MEM). Read-only.
    SectionHeader vitalsHeader = null!;
    Grid vitalsBody = null!;
    VitalsSample[]? vitalsHistory;
    readonly TextBlock footer;
    readonly TextBlock held;
    string? bodyKey, vitalsKey, footerKey, weatherKey, todayKey, foldKey, mediaKey, homeKey;
    (bool Cam, bool Vitals, bool Media, bool Home, bool Today) foldValue;
    Mark? lastMark;
    HashSet<string> shown = new();

    // TODAY: hairline, the header (always shown, the clock lives in it), then the body (the weather strip and the forecast row).
    readonly StackPanel todayBox = new();
    readonly StackPanel todayBody = new() { Visibility = Visibility.Collapsed };
    readonly StackPanel camBox = new() { Visibility = Visibility.Collapsed };
    // MEDIA: hairline, the header, then the body (the now-playing row and up to 3 download rows). Read-only.
    readonly StackPanel mediaBox = new() { Visibility = Visibility.Collapsed };
    readonly StackPanel mediaBody = new() { Visibility = Visibility.Collapsed };
    SectionHeader mediaHeader = null!;
    // HOME: hairline, the header, then up to 3 lines (lights, climate, containers). Read-only.
    readonly StackPanel homeBox = new() { Visibility = Visibility.Collapsed };
    readonly StackPanel homeBody = new() { Visibility = Visibility.Collapsed };
    SectionHeader homeHeader = null!;
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
    /// <summary>The same for the MEDIA body.</summary>
    public bool MediaFolded { get; private set; }
    /// <summary>The same for the HOME body.</summary>
    public bool HomeFolded { get; private set; }
    /// <summary>The same for the VITALS body.</summary>
    public bool VitalsFolded { get; private set; }

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

        // Vitals: a hairline, the header, then the body: three columns of (frame-w - 2 x sp-md) / 3 (88), the caption row and the spark row.
        vitalsHeader = new SectionHeader("vitals", Copy.VitalsTitle.ToUpperInvariant(), side);
        AutomationProperties.SetName(vitalsHeader, Copy.VitalsTitle);
        vitalsHeader.Click += (_, _) => SectionToggled?.Invoke("vitals");
        vitalsBody = new Grid { Margin = new Thickness(side, 0, side, 0), Height = VitalsBodyHeight, Background = Brushes.Transparent, Visibility = Visibility.Collapsed };
        foreach (var w in new[] { VitalsColumn, Theme.D("sp-md"), VitalsColumn, Theme.D("sp-md"), VitalsColumn })
            vitalsBody.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(w) });
        vitalsBody.RowDefinitions.Add(new RowDefinition { Height = new GridLength(Theme.D("lh-data")) });
        vitalsBody.RowDefinitions.Add(new RowDefinition { Height = new GridLength(Theme.D("sp-xs") + Theme.D("spark-h") + Theme.D("sp-md")) });
        vitalsBox.Children.Add(Hairline());
        vitalsBox.Children.Add(vitalsHeader);
        vitalsBox.Children.Add(vitalsBody);
        AutomationProperties.SetAutomationId(vitalsBox, "vitals-block");
        AutomationProperties.SetAutomationId(vitalsBody, "vitals-body");

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
        mediaHeader = new SectionHeader("media", Copy.MediaTitle.ToUpperInvariant(), side);
        AutomationProperties.SetName(mediaHeader, Copy.MediaTitle);
        mediaHeader.Click += (_, _) => SectionToggled?.Invoke("media");
        mediaBox.Children.Add(Hairline());
        mediaBox.Children.Add(mediaHeader);
        mediaBox.Children.Add(mediaBody);
        AutomationProperties.SetAutomationId(mediaBox, "media-block");
        stack.Children.Add(mediaBox);
        homeHeader = new SectionHeader("home", Copy.HomeTitle.ToUpperInvariant(), side);
        AutomationProperties.SetName(homeHeader, Copy.HomeTitle);
        homeHeader.Click += (_, _) => SectionToggled?.Invoke("home");
        homeBox.Children.Add(Hairline());
        homeBox.Children.Add(homeHeader);
        homeBox.Children.Add(homeBody);
        AutomationProperties.SetAutomationId(homeBox, "home-block");
        stack.Children.Add(homeBox);
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
        // MEDIA shows when something plays or a download runs; its open body is the fold's media height.
        var np = NowPlaying.Usable(m.Media?.NowPlaying);
        var dls = m.Media?.Downloads is { } dl ? dl.Items.Take(3).ToArray() : [];
        var dlCount = m.Media?.Downloads?.Count ?? 0;
        var mediaShown = np is not null || dlCount > 0;
        var mediaClosed = m.Closed?.Contains("media") == true;
        mediaBox.Visibility = mediaShown ? Visibility.Visible : Visibility.Collapsed;
        var mediaH = mediaShown && !mediaClosed ? (np is null ? 0 : Theme.D("row-height")) + dls.Length * Theme.D("more-height") : 0;
        // HOME shows when at least one of its three lines is usable; an error view (no glance) shows none. Its open body is the fold's home height.
        var hn = g is null ? null : m.Home;
        var hh = Home.Usable(hn?.Home);
        var hc = Containers.Usable(hn?.Containers);
        var homeLines = (hh?.Lights is null ? 0 : 1) + (hh?.Climate is null ? 0 : 1) + (hc is null ? 0 : 1);
        var homeClosed = m.Closed?.Contains("home") == true;
        homeBox.Visibility = homeLines > 0 ? Visibility.Visible : Visibility.Collapsed;
        var homeH = homeLines > 0 && !homeClosed ? homeLines * Theme.D("more-height") : 0;
        // VITALS: a glance always has the block (its body folds like the others); an error view shows the header only. The open body is the fold's vitals height.
        var vitalsClosed = m.Closed?.Contains("vitals") == true;
        var vitalsH = g is not null && !vitalsClosed ? VitalsBodyHeight : 0;
        (CameraFolded, VitalsFolded, MediaFolded, HomeFolded, TodayFolded) = Folds(m.WorkHeight, m.Camera, vitalsH, mediaH, homeH, rows);
        RenderVitals((GlanceOf(m.Latest) ?? g)?.Vitals, g is null, vitalsClosed, dim, asOf, m.History);
        RenderToday(m.Weather, forecast, now, asOf, closed);
        RenderMedia(m.Media, np, dls, dlCount, mediaShown, mediaClosed, asOf);
        RenderHome(hn, hh, hc, homeLines, homeClosed, asOf);
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

    // --- MEDIA (SHAPE "MEDIA"): the now-playing row and up to 3 download rows; nothing here is a button ---
    void RenderMedia(MediaNow? md, NowPlaying? np, DownloadItem[] dls, int count, bool shown, bool closed, string? asOf)
    {
        if (!shown) { mediaBody.Visibility = Visibility.Collapsed; return; }
        var folded = MediaFolded;
        var open = !closed && !folded;
        var dim = md!.Dim;
        mediaHeader.Label.Text = Copy.MediaTitle.ToUpperInvariant() + (asOf is null ? "" : " · " + asOf.ToUpperInvariant());
        // open, the rows say the same thing, except the downloads that do not fit: then the header carries the count
        mediaHeader.Meta.Text = closed || folded ? Copy.MediaMeta(np, count) : count > dls.Length ? Copy.MediaMeta(null, count) : "";
        mediaHeader.Meta.Foreground = Theme.B(folded ? "ink-faint" : open && !dim ? "ink" : "ink-dim"); // open meta matches TODAY's: ink, quieter when stale
        mediaHeader.Expanded = open;
        mediaHeader.IsEnabled = !folded;
        mediaHeader.Cursor = folded ? System.Windows.Input.Cursors.Arrow : System.Windows.Input.Cursors.Hand;
        mediaHeader.ToolTip = Copy.MediaHeaderTip(closed, folded);
        mediaHeader.Chevron.Visibility = folded ? Visibility.Collapsed : Visibility.Visible;
        mediaHeader.Chevron.RenderTransform = new RotateTransform(open ? 90 : 0); // points right when closed, down when open; snaps

        // A record prints an array as its type name, so the key joins the items.
        var key = dim + "|" + np + "|" + string.Join("|", dls.Select(d => d.ToString()));
        if (key != mediaKey)
        {
            mediaKey = key;
            mediaBody.Children.Clear();
            if (np is not null) mediaBody.Children.Add(NowPlayingRow(np, dim));
            foreach (var d in dls) mediaBody.Children.Add(DownloadRow(d, dim));
        }
        mediaBody.Visibility = open ? Visibility.Visible : Visibility.Collapsed;
    }

    // --- HOME (SHAPE "HOME"): the lights, climate and containers lines; nothing here is a button ---
    void RenderHome(HomeNow? hn, Home? h, Containers? c, int lines, bool closed, string? asOf)
    {
        if (lines == 0) { homeBody.Visibility = Visibility.Collapsed; return; }
        var folded = HomeFolded;
        var open = !closed && !folded;
        var dim = hn!.Dim;
        homeHeader.Label.Text = Copy.HomeTitle.ToUpperInvariant() + (asOf is null ? "" : " · " + asOf.ToUpperInvariant());
        homeHeader.Meta.Text = closed || folded ? Copy.HomeMeta(h, c) : ""; // open, the lines say it all
        homeHeader.Meta.Foreground = Theme.B(folded ? "ink-faint" : "ink-dim");
        homeHeader.Expanded = open;
        homeHeader.IsEnabled = !folded;
        homeHeader.Cursor = folded ? System.Windows.Input.Cursors.Arrow : System.Windows.Input.Cursors.Hand;
        homeHeader.ToolTip = Copy.HomeHeaderTip(closed, folded);
        homeHeader.Chevron.Visibility = folded ? Visibility.Collapsed : Visibility.Visible;
        homeHeader.Chevron.RenderTransform = new RotateTransform(open ? 90 : 0); // points right when closed, down when open; snaps

        var key = $"{dim}|{h}|{c}";
        if (key != homeKey)
        {
            homeKey = key;
            homeBody.Children.Clear();
            var ink = dim ? "ink-dim" : "ink";
            if (h?.Lights is { } l) homeBody.Children.Add(HomeLine(Copy.LightsCaption, Copy.LightsValue(l), l.LightsOn == 0 ? "ink-dim" : ink, null, ink, Copy.LightsTip(l), "home-lights"));
            if (h?.Climate is { } cl) homeBody.Children.Add(HomeLine(Copy.ClimateCaption, Copy.ClimateValue(cl), ink, null, ink, Copy.ClimateTip(cl), "home-climate"));
            if (c is not null) homeBody.Children.Add(HomeLine(Copy.ContainersCaption, Copy.ContainersValue(c), ink, Copy.ContainersIssue(c), dim ? "ink-dim" : c.Dead > 0 ? "bad" : "warn", Copy.ContainersTip(c), "home-containers"));
        }
        homeBody.Visibility = open ? Visibility.Visible : Visibility.Collapsed;
    }

    /// <summary>Caption left (trims), value right in mono (the issue, if any, a second run in its own colour). Same shape as a download row; not a button, not a tab stop.</summary>
    FrameworkElement HomeLine(string caption, string value, string valueBrush, string? issue, string issueBrush, string tip, string id)
    {
        var side = Theme.D("sp-lg") - Theme.D("hairline");
        var cap = Theme.Text(caption, "fs-label", "lh-label", "ink-faint", semibold: true);
        cap.VerticalAlignment = VerticalAlignment.Center;
        var val = Theme.Text(value, "fs-data", "lh-data", valueBrush, mono: true);
        if (issue is not null) val.Inlines.Add(new Run(" · " + issue) { Foreground = Theme.B(issueBrush) });
        val.VerticalAlignment = VerticalAlignment.Center;
        val.Margin = new Thickness(Theme.D("sp-base"), 0, 0, 0);
        Grid.SetColumn(val, 1);
        var row = new Grid { Height = Theme.D("more-height"), Margin = new Thickness(side, 0, side, 0), Background = Brushes.Transparent };
        row.ColumnDefinitions.Add(new ColumnDefinition());
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.Children.Add(cap);
        row.Children.Add(val);
        row.ToolTip = tip;
        AutomationProperties.SetName(row, tip);
        AutomationProperties.SetAutomationId(row, id);
        return row;
    }

    /// <summary>Title over "Series · App" in the item-row typography; a sp-hair progress bar on the row bottom (accent, ink-faint when paused or stale). No progress, no bar.</summary>
    FrameworkElement NowPlayingRow(NowPlaying np, bool dim)
    {
        var side = Theme.D("sp-lg") - Theme.D("hairline");
        var l1 = Theme.Text(np.Title!, "fs-title", "lh-title", dim ? "ink-dim" : "ink", semibold: true);
        var l2 = Theme.Text(Copy.NowPlayingLine2(np), "fs-body", "lh-body", dim ? "ink-faint" : "ink-dim");
        l2.Margin = new Thickness(0, Theme.D("sp-hair"), 0, 0);
        var row = new Grid { Height = Theme.D("row-height"), Margin = new Thickness(side, 0, side, 0), Background = Brushes.Transparent };
        row.Children.Add(new StackPanel { VerticalAlignment = VerticalAlignment.Center, Children = { l1, l2 } });
        if (np.Progress01 is { } p && double.IsFinite(p))
        {
            row.Children.Add(new Border { Height = Theme.D("sp-hair"), VerticalAlignment = VerticalAlignment.Bottom, Background = Theme.B("line") });
            var fill = new Border
            {
                Height = Theme.D("sp-hair"), Width = Math.Clamp(p, 0, 1) * Theme.D("frame-w"), HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Bottom, Background = Theme.B(np.State == "paused" || dim ? "ink-faint" : "accent"),
            };
            AutomationProperties.SetAutomationId(fill, "progress-fill");
            row.Children.Add(fill);
        }
        var tip = Copy.NowPlayingTip(np);
        row.ToolTip = tip;
        AutomationProperties.SetName(row, tip);
        AutomationProperties.SetAutomationId(row, "now-playing");
        return row;
    }

    /// <summary>The name trims; the right text ("43% · 2.1 MB/s", mono) never does. A stalled download or a stale view reads ink-faint.</summary>
    FrameworkElement DownloadRow(DownloadItem d, bool dim)
    {
        var side = Theme.D("sp-lg") - Theme.D("hairline");
        var name = Theme.Text(d.Name!, "fs-body", "lh-body", dim ? "ink-dim" : "ink");
        name.VerticalAlignment = VerticalAlignment.Center;
        var stalled = d.SpeedBps is not { } s || !double.IsFinite(s) || s <= 0;
        var right = Theme.Text(Copy.DownloadRight(d), "fs-note", "lh-note", dim || stalled ? "ink-faint" : "ink-dim", mono: true);
        right.VerticalAlignment = VerticalAlignment.Center;
        right.Margin = new Thickness(Theme.D("sp-base"), 0, 0, 0);
        Grid.SetColumn(right, 1);
        var row = new Grid { Height = Theme.D("more-height"), Margin = new Thickness(side, 0, side, 0), Background = Brushes.Transparent };
        row.ColumnDefinitions.Add(new ColumnDefinition());
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.Children.Add(name);
        row.Children.Add(right);
        var tip = Copy.DownloadTip(d);
        row.ToolTip = tip;
        AutomationProperties.SetName(row, tip);
        AutomationProperties.SetAutomationId(row, "download");
        return row;
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

    /// <summary>Which open parts do not fit the work area less sp-lg (SHAPE "Fold rule"), folding one at a time: the camera first, then VITALS, MEDIA, HOME, then TODAY. While Live is on the camera
    /// goes last, so VITALS, MEDIA, HOME and TODAY fold first and Live ends only if it still does not fit. Measured without the camera block and the VITALS, MEDIA, HOME and TODAY bodies, so it never depends on their own state.
    /// No work height (infinity) or nothing foldable answers all false without measuring; the key still records it so a later finite height never reuses a stale answer.</summary>
    (bool Cam, bool Vitals, bool Media, bool Home, bool Today) Folds(double work, Cam? c, double vitalsH, double mediaH, double homeH, int todayRows)
    {
        // The key holds the VITALS body height, never the sample count: a new sample must not re-run the probe.
        var key = $"{bodyKey}|{work}|{c is null}|{c?.Live}|{c?.Collapsed}|{todayRows}|{vitalsH}|{mediaBox.Visibility}|{mediaH}|{homeBox.Visibility}|{homeH}";
        if (key == foldKey) return foldValue;
        foldKey = key;
        if (double.IsPositiveInfinity(work) || (c is null && vitalsH == 0 && mediaH == 0 && homeH == 0 && todayRows == 0)) return foldValue = (false, false, false, false, false);
        FoldProbes++;
        camBox.Visibility = Visibility.Collapsed;
        vitalsBody.Visibility = Visibility.Collapsed;
        todayBody.Visibility = Visibility.Collapsed;
        mediaBody.Visibility = Visibility.Collapsed;
        homeBody.Visibility = Visibility.Collapsed;
        Stale(this); // a laid-out tree would answer from its cache and still count the blocks just collapsed
        Measure(new Size(Width, double.PositiveInfinity));
        var baseHeight = DesiredSize.Height;
        Stale(this); // the probe left every cached size short of the blocks; the next layout pass measures it all again
        var limit = work - Theme.D("sp-lg");
        var head = Theme.D("hairline") + Theme.D("more-height");
        var live = c?.Live == true;
        bool cam = false, vitals = false, media = false, home = false, today = false;
        double Total() => baseHeight + (c is null ? 0 : c.Collapsed || cam ? head : OpenCameraHeight(live)) + (vitals ? 0 : vitalsH) + (media ? 0 : mediaH) + (home ? 0 : homeH) + (today ? 0 : todayRows * Theme.D("row-height"));
        foreach (var part in live ? new[] { "vitals", "media", "home", "today", "cam" } : new[] { "cam", "vitals", "media", "home", "today" })
        {
            if (Total() <= limit) break;
            if (part == "cam" && c is { Collapsed: false }) cam = true;
            else if (part == "vitals" && vitalsH > 0) vitals = true;
            else if (part == "media" && mediaH > 0) media = true;
            else if (part == "home" && homeH > 0) home = true;
            else if (part == "today" && todayRows > 0) today = true;
        }
        return foldValue = (cam, vitals, media, home, today);
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

    // --- VITALS (SHAPE "VITALS"): the header, then the three captions with the CPU and MEM sparks under them; nothing in the body is a button ---
    void RenderVitals(Vitals? v, bool noGlance, bool closed, bool dim, string? asOf, VitalsSample[]? history)
    {
        if (noGlance) v = null; // an error view has no glance: the header alone says so
        var folded = VitalsFolded;
        var open = !noGlance && !closed && !folded;
        vitalsHeader.Label.Text = Copy.VitalsTitle.ToUpperInvariant() + (noGlance || asOf is null ? "" : " · " + asOf.ToUpperInvariant());
        // open, the captions say it all; stale, the label carries "AS OF hh:mm", so the summary drops DISK to keep the header from overlapping (SHAPE check 8)
        vitalsHeader.Meta.Text = noGlance || closed || folded ? Copy.VitalsMeta(v, withDisk: !dim) : "";
        vitalsHeader.Meta.Foreground = Theme.B(noGlance || folded ? "ink-faint" : "ink-dim");
        vitalsHeader.Collapsible = !noGlance;
        vitalsHeader.Expanded = open;
        vitalsHeader.IsEnabled = !folded;
        vitalsHeader.Cursor = folded || noGlance ? System.Windows.Input.Cursors.Arrow : System.Windows.Input.Cursors.Hand;
        vitalsHeader.ToolTip = noGlance ? null : Copy.VitalsHeaderTip(closed, folded);
        vitalsHeader.Chevron.Visibility = noGlance || folded ? Visibility.Collapsed : Visibility.Visible;
        vitalsHeader.Chevron.RenderTransform = new RotateTransform(open ? 90 : 0); // points right when closed, down when open; snaps

        // The body is redrawn when the values or the stale look change, or when the history is a new array (a poll added a sample): never on a clock tick.
        var key = $"{v}|{dim}";
        if (key != vitalsKey || !ReferenceEquals(history, vitalsHistory))
        {
            vitalsKey = key;
            vitalsHistory = history;
            vitalsBody.Children.Clear();
            vitalsBody.ToolTip = null;
            if (v is null)
            {
                var none = Theme.Text(Copy.VitalsUnavailable, "fs-note", "lh-note", "ink-faint");
                none.VerticalAlignment = VerticalAlignment.Center;
                Grid.SetColumnSpan(none, 5);
                Grid.SetRowSpan(none, 2);
                AutomationProperties.SetAutomationId(none, "vitals-null");
                vitalsBody.Children.Add(none);
            }
            else
            {
                Cap(0, "vitals-cpu", "CPU", Copy.VitalsPct(v.Cpu), dim);
                Cap(2, "vitals-mem", "MEM", Copy.VitalsPct(v.Mem), dim);
                Cap(4, "vitals-disk", "DISK", v.DiskMax is { } d ? Copy.VitalsPct(d) : Copy.NullFigure, dim);
                var enough = history is { Length: >= 2 };
                Spark(0, "vitals-spark-cpu", "CPU history", enough ? history!.Select(s => s.Cpu).ToArray() : null, dim);
                Spark(2, "vitals-spark-mem", "MEM history", enough ? history!.Select(s => s.Mem).ToArray() : null, dim);
                if (!enough) vitalsBody.ToolTip = Copy.VitalsCollecting; // the slots stay empty at full height
            }
        }
        vitalsBody.Visibility = open ? Visibility.Visible : Visibility.Collapsed;
    }

    /// <summary>One column's caption: the label (fs-label semibold) and the value (fs-data mono), the runs the single vitals line used.</summary>
    void Cap(int column, string id, string caption, string value, bool dim)
    {
        var t = Theme.Text("", "fs-data", "lh-data", "ink-dim");
        t.Inlines.Add(new Run(caption + " ") { Foreground = Theme.B(dim ? "ink-dim" : "ink-faint"), FontSize = Theme.D("fs-label"), FontWeight = FontWeights.SemiBold });
        t.Inlines.Add(new Run(value) { Foreground = Theme.B(dim ? "ink-dim" : "ink"), FontFamily = Theme.F("font-mono"), FontSize = Theme.D("fs-data") });
        Grid.SetColumn(t, column);
        AutomationProperties.SetAutomationId(t, id);
        vitalsBody.Children.Add(t);
    }

    /// <summary>A hairline polyline in accent (ink-faint when stale): the samples spread over the column, y on a fixed 0-100% scale so a line never rescales between polls. The stroke is inset by half its width so 0% and 100% are not clipped.</summary>
    void Spark(int column, string id, string name, double[]? values, bool dim)
    {
        double w = VitalsColumn, h = Theme.D("spark-h"), sw = Theme.D("hairline");
        var slot = new Canvas { Width = w, Height = h, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, Theme.D("sp-xs"), 0, 0) };
        if (values is not null)
            slot.Children.Add(new Polyline
            {
                Points = new PointCollection(values.Select((x, i) => new Point(i * w / (values.Length - 1), sw / 2 + (1 - Math.Clamp(x, 0, 100) / 100) * (h - sw)))),
                Stroke = Theme.B(dim ? "ink-faint" : "accent"),
                StrokeThickness = sw,
                StrokeLineJoin = PenLineJoin.Round,
                SnapsToDevicePixels = false,
            });
        Grid.SetColumn(slot, column);
        Grid.SetRow(slot, 1);
        AutomationProperties.SetAutomationId(slot, id);
        AutomationProperties.SetName(slot, name);
        vitalsBody.Children.Add(slot);
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
