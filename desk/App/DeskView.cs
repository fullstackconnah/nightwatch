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
internal sealed record Model(View Committed, View Latest, bool UpdateHeld, bool Hover1 = false, bool Focus1 = false, Strip? Weather = null, Cam? Camera = null);

/// <summary>The weather strip; null on the model means hidden. Dim: the last values, temperature and glyph quieter.</summary>
internal sealed record Strip(WeatherNow Weather, bool Dim);

/// <summary>The camera block; null on the model means hidden. WorkHeight is the monitor's work-area height in DIP (infinity: no fit-fold).</summary>
internal sealed record Cam(bool Collapsed, double WorkHeight, FrameState State, System.Windows.Media.ImageSource? Image, DateTimeOffset? FrameAt, bool HoverFrame = false, bool FocusHeader = false);

/// <summary>The camera header is a button that also reports ExpandCollapse to screen readers.</summary>
internal sealed class CameraHeader : Button
{
    public bool Expanded { get; set; }
    protected override System.Windows.Automation.Peers.AutomationPeer OnCreateAutomationPeer() => new Peer(this);

    sealed class Peer(CameraHeader h) : System.Windows.Automation.Peers.ButtonAutomationPeer(h), System.Windows.Automation.Provider.IExpandCollapseProvider
    {
        public override object? GetPattern(System.Windows.Automation.Peers.PatternInterface p) =>
            p == System.Windows.Automation.Peers.PatternInterface.ExpandCollapse ? this : base.GetPattern(p);
        public System.Windows.Automation.ExpandCollapseState ExpandCollapseState =>
            h.Expanded ? System.Windows.Automation.ExpandCollapseState.Expanded : System.Windows.Automation.ExpandCollapseState.Collapsed;
        public void Expand() { if (!h.Expanded) h.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent)); }
        public void Collapse() { if (h.Expanded) h.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent)); }
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
    string? bodyKey, vitalsKey, footerKey, weatherKey, foldKey;
    bool foldValue;
    Mark? lastMark;
    HashSet<string> shown = new();

    readonly StackPanel weatherBox = new() { Visibility = Visibility.Collapsed };
    readonly StackPanel camBox = new() { Visibility = Visibility.Collapsed };
    readonly CameraHeader camHeader = new();
    readonly Button camFrame = new();
    readonly Image frameImage = new();
    // Built in BuildCamera: they read tokens, which load in the constructor.
    TextBlock camAge = null!, frameMsg1 = null!, frameMsg2 = null!;
    FrameworkElement camChev = null!;

    /// <summary>Called with a relative href ("/..."); the host prefixes the base address.</summary>
    public Action<string>? Open;
    /// <summary>The camera header was clicked; the host flips and saves the collapsed flag.</summary>
    public Action? CameraToggled;
    /// <summary>True while the camera block is showing only its header because the screen is too short (a view state, never saved).</summary>
    public bool CameraFolded { get; private set; }

    public Button CameraHeaderButton => camHeader;
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
        stack.Children.Add(weatherBox);
        BuildCamera(side);
        stack.Children.Add(camBox);
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

        RenderWeather(m.Weather);
        CameraFolded = m.Camera is { Collapsed: false } c && FitFolds(c.WorkHeight);
        FillCamera(m.Camera);
    }

    // --- weather strip (SHAPE 2): two lines in the row shape, not interactive, not a tab stop ---
    void RenderWeather(Strip? s)
    {
        var key = s?.ToString() ?? "";
        if (key == weatherKey) return;
        weatherKey = key;
        weatherBox.Children.Clear();
        weatherBox.Visibility = s is null ? Visibility.Collapsed : Visibility.Visible;
        if (s is null) return;

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
        weatherBox.Children.Add(Hairline());
        weatherBox.Children.Add(strip);
    }

    // --- camera block (SHAPE 3) ---
    void BuildCamera(double side)
    {
        camAge = Theme.Text("", "fs-note", "lh-note", "ink-dim", mono: true);
        camAge.VerticalAlignment = VerticalAlignment.Center;
        camChev = Chevron();
        camChev.VerticalAlignment = VerticalAlignment.Center;
        camChev.RenderTransformOrigin = new Point(.5, .5);
        camChev.Margin = new Thickness(Theme.D("sp-base"), 0, 0, 0);
        var title = Theme.Text(Copy.CameraTitle.ToUpperInvariant(), "fs-label", "lh-label", "ink-faint", semibold: true);
        title.VerticalAlignment = VerticalAlignment.Center;
        var right = new StackPanel { Orientation = Orientation.Horizontal, Children = { camAge, camChev } };
        Grid.SetColumn(right, 1);
        var head = new Grid { Margin = new Thickness(side, 0, side, 0) };
        head.ColumnDefinitions.Add(new ColumnDefinition());
        head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        head.Children.Add(title);
        head.Children.Add(right);
        camHeader.Style = (Style)Application.Current.Resources["RowButton"];
        camHeader.Height = Theme.D("more-height");
        camHeader.Content = head;
        AutomationProperties.SetAutomationId(camHeader, "camera-header");
        AutomationProperties.SetName(camHeader, Copy.CameraHeaderName);
        camHeader.Click += (_, _) => CameraToggled?.Invoke();

        var w = Theme.D("frame-w"); var h = Theme.D("frame-h");
        frameImage.Stretch = Stretch.Uniform;
        RenderOptions.SetBitmapScalingMode(frameImage, BitmapScalingMode.HighQuality);
        frameMsg1 = Theme.Text("", "fs-body", "lh-body", "ink-dim");
        frameMsg2 = Theme.Text("", "fs-note", "lh-note", "ink-faint", mono: true);
        frameMsg1.TextAlignment = TextAlignment.Center;
        frameMsg2.TextAlignment = TextAlignment.Center;
        frameMsg2.Margin = new Thickness(0, Theme.D("sp-xs"), 0, 0);
        var msg = new StackPanel { HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center, Children = { frameMsg1, frameMsg2 } };
        var content = new Grid
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
        camBox.Children.Add(camHeader);
        camBox.Children.Add(camFrame);
    }

    static double OpenCameraHeight => Theme.D("hairline") + Theme.D("more-height") + Theme.D("frame-h") + Theme.D("sp-md");

    /// <summary>True when the window with the camera open would be taller than the work area less sp-lg (SHAPE 1, fit-fold). Measured without the block, so it never depends on the block's own state.</summary>
    bool FitFolds(double workHeight)
    {
        var key = $"{bodyKey}|{weatherKey}|{vitalsBox.Visibility}|{workHeight}";
        if (key == foldKey) return foldValue;
        foldKey = key;
        camBox.Visibility = Visibility.Collapsed;
        Measure(new Size(Width, double.PositiveInfinity));
        var h = DesiredSize.Height;
        Stale(this); // the probe left every cached size short of the block; the next layout pass measures it all again
        return foldValue = h + OpenCameraHeight > workHeight - Theme.D("sp-lg");
    }

    static void Stale(DependencyObject o)
    {
        (o as UIElement)?.InvalidateMeasure();
        for (var i = 0; o is Visual && i < VisualTreeHelper.GetChildrenCount(o); i++) Stale(VisualTreeHelper.GetChild(o, i));
    }

    void FillCamera(Cam? c)
    {
        if (c is null) { camBox.Visibility = Visibility.Collapsed; return; }
        var folded = CameraFolded;
        var open = !c.Collapsed && !folded;
        camBox.Visibility = Visibility.Visible;

        camHeader.Expanded = open;
        camHeader.IsEnabled = !folded;
        camHeader.Cursor = folded ? System.Windows.Input.Cursors.Arrow : System.Windows.Input.Cursors.Hand;
        camHeader.ToolTip = Copy.CameraHeaderTip(c.Collapsed, folded);
        camChev.Visibility = folded ? Visibility.Collapsed : Visibility.Visible;
        camChev.RenderTransform = new RotateTransform(open ? 90 : 0); // points right when closed, down when open; snaps
        Snap.SetForceFocus(camHeader, c.FocusHeader);

        var shown = open && c.State is FrameState.Live or FrameState.Stale && c.FrameAt is not null;
        var at = c.FrameAt is { } t ? TimeZoneInfo.ConvertTime(t, tz).DateTime : (DateTime?)null;
        camAge.Text = folded ? Copy.CameraFolded : open && shown ? Copy.FrameAge(at!.Value) : "";
        camAge.FontFamily = Theme.F(folded ? "font-sans" : "font-mono");
        camAge.Foreground = Theme.B(folded ? "ink-faint" : c.State == FrameState.Stale ? "warn" : "ink-dim");

        camFrame.Visibility = open ? Visibility.Visible : Visibility.Collapsed;
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
