using System.Windows;
using System.Windows.Automation;
using System.Windows.Automation.Peers;
using System.Windows.Automation.Provider;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using NightwatchDesk.Core;

namespace NightwatchDesk.App.Tests;

/// <summary>Watch live (desk-live SHAPE "Camera live view"): the feed's Live rules and the header, frame and fold layout.</summary>
public class LiveTests
{
    // --- the feed ---------------------------------------------------------------------------
    sealed class Rig
    {
        public int Fetches;
        public DateTimeOffset Now = new(2026, 1, 1, 14, 0, 0, TimeSpan.Zero);
        public bool Fail;
        public readonly CameraFeed Feed;
        public Rig()
        {
            var jpeg = Snapshot.TestFrame(640, 360, "16:9");
            Feed = new CameraFeed(_ => { Fetches++; return Task.FromResult<FrameOutcome>(Fail ? new FrameOutcome.Failure() : new FrameOutcome.Frame(jpeg)); }, () => Now, () => 1)
            { IntervalSeconds = 30 };
        }
        public void LiveTick() => Feed.LiveTickAsync().GetAwaiter().GetResult();
    }

    [Theory]
    [InlineData("live button")]
    [InlineData("chevron")]
    [InlineData("hide")]
    [InlineData("lock")]
    [InlineData("suspend")]
    [InlineData("fold")]
    [InlineData("401")]
    public void Each_stop_cause_ends_Live_and_nothing_restarts_it(string cause)
    {
        Sta.Run(() =>
        {
            Theme.EnsureLoaded();
            var r = new Rig();
            r.Feed.BlockHidden = false; // the open still: first fetch
            r.Feed.StartLive();
            Assert.True(r.Feed.Live);
            var started = r.Fetches;
            r.LiveTick();
            Assert.Equal(started + 1, r.Fetches); // Live polls on the 1 s tick

            var told = 0;
            r.Feed.Changed += () => told++;
            void Stop(bool on)
            {
                switch (cause)
                {
                    case "live button": if (on) r.Feed.EndLive(); break;
                    case "chevron" or "fold": r.Feed.BlockHidden = on; break; // both leave the block hidden: the chevron closes it, a fold hides it
                    case "hide": r.Feed.WindowHidden = on; break;
                    case "lock": r.Feed.Locked = on; break;
                    case "suspend": r.Feed.Suspended = on; break;
                    case "401": r.Feed.ClientError = on; break;
                }
            }
            Stop(true);
            Assert.False(r.Feed.Live);
            Assert.Equal(1, told); // the view is told once, so it redraws as the still
            var before = r.Fetches;
            for (var i = 0; i < 3; i++) r.LiveTick();
            Assert.Equal(before, r.Fetches); // no 1 s poll after the stop

            Stop(false); // the pause lifts: the still resumes with one fetch and Live stays off
            Assert.False(r.Feed.Live);
            var resumed = r.Fetches;
            Assert.InRange(resumed - before, 0, 1);
            for (var i = 0; i < 3; i++) r.LiveTick();
            Assert.Equal(resumed, r.Fetches);
            Fix.Rec($"LIVE stop cause {cause}", $"ended, polls after stop 0, resume fetches {resumed - before}");
        });
    }

    [Fact]
    public void A_fold_on_a_block_that_was_already_hidden_still_ends_Live()
    {
        Sta.Run(() =>
        {
            Theme.EnsureLoaded();
            var r = new Rig(); // the block starts hidden (collapsed): Watch live opens it, so StartLive comes first
            r.Feed.StartLive();
            Assert.True(r.Feed.Live);
            Assert.Equal(0, r.Fetches); // nothing shows yet, so nothing is fetched
            r.Feed.BlockHidden = true; // the next Update says: folded
            Assert.False(r.Feed.Live);
        });
    }

    [Fact]
    public void Live_ages_at_5_and_60_seconds_and_the_still_rule_applies_again_after_Live()
    {
        Sta.Run(() =>
        {
            Theme.EnsureLoaded();
            var r = new Rig();
            r.Feed.BlockHidden = false;
            r.Feed.StartLive();
            var t0 = r.Now;
            FrameState At(double s) { r.Now = t0.AddSeconds(s); return r.Feed.State; }
            Assert.Equal(FrameState.Live, At(5));
            Assert.Equal(FrameState.Stale, At(5.5));
            Assert.Equal(FrameState.Stale, At(59));
            Assert.Equal(FrameState.NoPicture, At(60));
            r.Feed.EndLive();
            Assert.Equal(FrameState.Live, At(10)); // the still's 2 x 30 s
            Assert.Equal(FrameState.Stale, At(65));
            Fix.Rec("LIVE ages", "Live to 5 s, Stale to 60 s, No picture from 60 s; the still keeps 60 s / 300 s");
        });
    }

    [Fact]
    public void Entering_Live_wakes_the_camera_once_decodes_at_the_Live_width_and_keeps_one_request_in_flight()
    {
        var jpeg = Sta.Run(() => { Theme.EnsureLoaded(); return Snapshot.TestFrame(640, 360, "16:9"); });
        var gate = new TaskCompletionSource<FrameOutcome>();
        var n = 0;
        var now = new DateTimeOffset(2026, 1, 1, 14, 0, 0, TimeSpan.Zero);
        var feed = Sta.Run(() => new CameraFeed(_ => ++n == 2 ? gate.Task : Task.FromResult<FrameOutcome>(new FrameOutcome.Frame(jpeg)), () => now, () => 1));
        Sta.Run(() =>
        {
            feed.BlockHidden = false;
            Assert.NotNull(feed.Image);
            feed.StartLive(); // fetch 2 is held at the gate
            Assert.Null(feed.Image);
            Assert.Null(feed.FrameAt);
            Assert.Equal(FrameState.Loading, feed.State); // "Waking the camera…"
            for (var i = 0; i < 3; i++) feed.LiveTickAsync().GetAwaiter().GetResult();
            Assert.Equal(2, n); // the 1 s tick makes no second request while one is in flight
            gate.SetResult(new FrameOutcome.Frame(jpeg));
        });
        Sta.Run(() => { }); // runs after the queued continuation
        Sta.Run(() =>
        {
            Assert.Equal(FrameState.Live, feed.State);
            Assert.Equal((int)Theme.D("frame-live-w"), ((BitmapSource)feed.Image!).PixelWidth);
        });
    }

    [Fact]
    public void A_failed_Live_frame_keeps_the_last_one_and_ages_it()
    {
        Sta.Run(() =>
        {
            Theme.EnsureLoaded();
            var r = new Rig();
            r.Feed.BlockHidden = false;
            r.Feed.StartLive();
            var t0 = r.Now;
            r.Fail = true;
            r.Now = t0.AddSeconds(3); r.LiveTick();
            Assert.NotNull(r.Feed.Image);
            Assert.Equal(t0, r.Feed.FrameAt);
            r.Now = t0.AddSeconds(10); r.LiveTick();
            Assert.Equal(FrameState.Stale, r.Feed.State);
            Assert.NotNull(r.Feed.Image);
            r.Now = t0.AddSeconds(61); r.LiveTick();
            Assert.Equal(FrameState.NoPicture, r.Feed.State);
            Assert.Null(r.Feed.Image); // dropped from memory at No picture
            Assert.Equal(t0, r.Feed.FrameAt); // the time stays for "Last frame at"
        });
    }

    [Fact]
    public void Live_is_never_saved()
    {
        Assert.DoesNotContain(typeof(WinState).GetProperties(), p => p.Name.Contains("Live", StringComparison.OrdinalIgnoreCase));
    }

    // --- the header, the frame and the fold -------------------------------------------------
    static readonly string[] Watch = { "camera-watch-waking", "camera-watch-on", "camera-watch-stale", "camera-watch-no-picture", "camera-watch-letterbox", "camera-watch-focus" };

    static FrameworkElement One(DependencyObject root, string id) =>
        Fix.Walk<FrameworkElement>(root).Single(e => AutomationProperties.GetAutomationId(e) == id);

    static Rect Bounds(Snapshot.Composed c, FrameworkElement e) => e.TransformToAncestor(c.View).TransformBounds(new Rect(0, 0, e.ActualWidth, e.ActualHeight));

    static double Natural(TextBlock t)
    {
        t.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        var w = t.DesiredSize.Width;
        t.InvalidateMeasure();
        return w;
    }

    static void Near(string n, double want, double got, double tol = 0.05) { Fix.Rec(n, got.ToString("0.###")); Assert.InRange(got, want - tol, want + tol); }

    static Color Brush(string key) => ((SolidColorBrush)Theme.B(key)).Color;

    [Theory]
    [InlineData("camera-collapsed")]
    [InlineData("camera-live")]
    [InlineData("camera-folded")]
    [InlineData("camera-watch-waking")]
    [InlineData("camera-watch-on")]
    [InlineData("camera-watch-stale")]
    [InlineData("camera-watch-no-picture")]
    [InlineData("camera-watch-letterbox")]
    [InlineData("camera-watch-folded")]
    [InlineData("camera-watch-focus")]
    public void N1_window_width_is_320_in_every_camera_state(string state)
    {
        var c = Sta.Run(() => Fix.Compose(state));
        Sta.Run(() => Near($"N1 width ({state})", 320, c.View.ActualWidth, 0.01));
    }

    [Fact]
    public void N5_N6_live_frame_318_by_179_bleeds_to_1_dip_and_the_blocks_are_207_and_212()
    {
        foreach (var dpi in new[] { 96, 144 })
        {
            var tol = dpi == 96 ? 0.05 : 0.7; // at 150% one device pixel is 0.67 DIP and 179 DIP is 268.5 px
            foreach (var state in Watch)
            {
                var c = Sta.Run(() => Fix.Compose(state, dpi));
                Sta.Run(() =>
                {
                    var f = One(c.View, "camera-frame");
                    var b = Bounds(c, f);
                    Near($"N5 live frame width ({state} {dpi})", 318, f.ActualWidth, tol);
                    Near($"N5 live frame height ({state} {dpi})", 179, f.ActualHeight, tol);
                    Near($"N5 live frame left ({state} {dpi})", 1, b.Left, tol);
                    Near($"N5 live frame right gap ({state} {dpi})", 1, c.View.ActualWidth - b.Right, tol);
                    Near($"N6 live block ({state} {dpi})", 212, One(c.View, "camera-block").ActualHeight, tol);
                    // header 33 = hairline + 32, then the frame at once (no gap)
                    var head = Bounds(c, One(c.View, "camera-header"));
                    Near($"N6 header bottom ({state} {dpi})", 33, head.Bottom - Bounds(c, One(c.View, "camera-block")).Top, tol);
                    Near($"N6 frame top meets header ({state} {dpi})", head.Bottom, b.Top, tol);
                    // square corners: no rounded clip on the picture, a square line
                    Assert.Null(((FrameworkElement)((Button)f).Content).Clip);
                    var edge = Fix.Walk<Border>(f).First(x => x.Name == "Edge");
                    Assert.Equal(new CornerRadius(0), edge.CornerRadius);
                    Assert.Equal(Stretch.Uniform, Fix.Walk<Image>(f).Single().Stretch);
                });
            }
        }
        // the still is untouched: 288 x 162 with its 16 DIP inset, block 207
        var still = Sta.Run(() => Fix.Compose("camera-live"));
        Sta.Run(() =>
        {
            var f = One(still.View, "camera-frame");
            Near("N5 still width", 288, f.ActualWidth);
            Near("N5 still height", 162, f.ActualHeight);
            Near("N5 still left", 16, Bounds(still, f).Left);
            Near("N6 still block", 207, One(still.View, "camera-block").ActualHeight);
            Assert.Equal(Copy.CameraFrameTip, f.ToolTip);
        });
        Fix.Rec("N5 tokens", $"frame-live-w {Sta.Run(() => Theme.D("frame-live-w"))} frame-live-h {Sta.Run(() => Theme.D("frame-live-h"))}");
    }

    [Fact]
    public void Letterbox_in_Live_shows_the_bg_either_side_of_a_4_to_3_picture()
    {
        foreach (var dpi in new[] { 96, 144 })
        {
            var c = Sta.Run(() => Fix.Compose("camera-watch-letterbox", dpi));
            Sta.Run(() =>
            {
                var b = Bounds(c, One(c.View, "camera-frame"));
                var s = dpi / 96.0;
                // 4:3 at 179 high is 238.7 wide, so about 39 DIP either side are the frame fill
                var p = LayoutTests.Pixel(c.Bitmap, (int)((b.Left + Snapshot.Backdrop + 10) * s), (int)((b.Top + Snapshot.Backdrop + b.Height / 2) * s));
                Fix.Rec($"LIVE letterbox pixel ({dpi})", p.ToString());
                Assert.Equal(Brush("bg"), p);
            });
        }
    }

    [Fact]
    public void The_live_button_is_its_own_button_with_toggle_state_names_tips_and_one_accent_dot()
    {
        var off = Sta.Run(() => Fix.Compose("camera-live"));
        var on = Sta.Run(() => Fix.Compose("camera-watch-on"));
        Sta.Run(() =>
        {
            var b = off.View.CameraLiveButton;
            // not nested in the toggle, and a sibling of it
            for (DependencyObject? o = b; o is not null; o = VisualTreeHelper.GetParent(o))
                Assert.NotSame(off.View.CameraHeaderButton, o);
            Assert.Equal("Watch the front door live", AutomationProperties.GetName(b));
            Assert.Equal("Watch the front door, updated every second", b.ToolTip);
            Assert.Contains("Watch live", Fix.Walk<TextBlock>(b).Select(t => t.Text));
            Assert.Equal(Visibility.Collapsed, Fix.Walk<Ellipse>(b).Single().Visibility);
            Assert.Equal(ToggleState.Off, ((IToggleProvider)UIElementAutomationPeer.CreatePeerForElement(b).GetPattern(PatternInterface.Toggle)!).ToggleState);
            Assert.Equal(Brush("ink-dim"), ((SolidColorBrush)Fix.Walk<TextBlock>(b).Single().Foreground).Color);

            var lb = on.View.CameraLiveButton;
            Assert.Equal("Watch the front door live", AutomationProperties.GetName(lb)); // the name never changes; the toggle state says on
            Assert.Equal("Stop the live view", lb.ToolTip);
            Assert.Equal(ToggleState.On, ((IToggleProvider)UIElementAutomationPeer.CreatePeerForElement(lb).GetPattern(PatternInterface.Toggle)!).ToggleState);
            var dot = Fix.Walk<Ellipse>(lb).Single();
            Assert.Equal(Visibility.Visible, dot.Visibility);
            Assert.Equal(Brush("accent"), ((SolidColorBrush)dot.Fill).Color);
            Assert.Equal(Theme.D("dot"), dot.Width);
            var label = Fix.Walk<TextBlock>(lb).Single();
            Assert.Equal("Live", label.Text);
            Assert.Equal(Brush("ink"), ((SolidColorBrush)label.Foreground).Color);
            Assert.Equal(TextTrimming.CharacterEllipsis, label.TextTrimming);
            Assert.Equal(Copy.CameraLiveFrameTip, One(on.View, "camera-frame").ToolTip);
            Assert.Equal(Copy.CameraFrameTip, One(off.View, "camera-frame").ToolTip);

            // the click reaches the host, once; the peer's Toggle is the same click
            var n = 0; on.View.CameraLiveToggled = () => n++;
            lb.RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent));
            ((IToggleProvider)UIElementAutomationPeer.CreatePeerForElement(lb).GetPattern(PatternInterface.Toggle)!).Toggle();
            Assert.Equal(2, n);
            Fix.Rec("LIVE button", "separate sibling, toggle off/on, one accent dot");
        });
    }

    [Fact]
    public void Live_meta_is_empty_when_fresh_warn_with_the_age_when_stale_and_the_frame_text_follows_the_state()
    {
        var wake = Sta.Run(() => Fix.Compose("camera-watch-waking"));
        var fresh = Sta.Run(() => Fix.Compose("camera-watch-on"));
        var stale = Sta.Run(() => Fix.Compose("camera-watch-stale"));
        var none = Sta.Run(() => Fix.Compose("camera-watch-no-picture"));
        Sta.Run(() =>
        {
            string Meta(Snapshot.Composed c) => ((TextBlock)One(c.View, "camera-meta")).Text;
            string[] Msgs(Snapshot.Composed c) => Fix.Walk<TextBlock>(One(c.View, "camera-frame")).Where(t => t.Visibility == Visibility.Visible).Select(t => t.Text).ToArray();
            Image Img(Snapshot.Composed c) => Fix.Walk<Image>(One(c.View, "camera-frame")).Single();

            Assert.Equal(new[] { "Waking the camera…" }, Msgs(wake));
            Assert.Equal("", Meta(wake));
            Assert.Null(Img(wake).Source);

            Assert.Equal("", Meta(fresh));
            Assert.NotNull(Img(fresh).Source);
            Assert.Equal(1, Img(fresh).Opacity);

            Assert.Equal("as of 14:04:40", Meta(stale));
            Assert.Equal(Brush("warn"), ((SolidColorBrush)((TextBlock)One(stale.View, "camera-meta")).Foreground).Color);
            Assert.Equal(Theme.D("frame-dim"), Img(stale).Opacity);
            Assert.NotNull(Img(stale).Source);

            Assert.Null(Img(none).Source);
            Assert.Equal("", Meta(none));
            var m = Msgs(none);
            Assert.Equal("No picture", m[0]);
            Assert.Equal("Last frame at 14:03:59", m[1]);
        });
    }

    [Fact]
    public void Folded_disables_both_buttons_and_Live_focus_shows_the_ring_on_the_live_button()
    {
        var folded = Sta.Run(() => Fix.Compose("camera-watch-folded"));
        var focus = Sta.Run(() => Fix.Compose("camera-watch-focus"));
        Sta.Run(() =>
        {
            Assert.False(folded.View.CameraHeaderButton.IsEnabled);
            Assert.False(folded.View.CameraLiveButton.IsEnabled);
            Assert.True(folded.View.CameraFolded);
            Assert.Equal(Visibility.Collapsed, One(folded.View, "camera-frame").Visibility);
            Assert.Equal(Brush("ink-faint"), ((SolidColorBrush)Fix.Walk<TextBlock>(folded.View.CameraLiveButton).Single().Foreground).Color);
            Assert.Equal("Hidden to fit the screen", ((TextBlock)One(folded.View, "camera-meta")).Text);
            Near("N6 folded block", 33, One(folded.View, "camera-block").ActualHeight);

            Assert.Equal(Visibility.Visible, Fix.Walk<Border>(focus.View.CameraLiveButton).First(b => b.Name == "Ring").Visibility);
            Assert.Equal(Visibility.Collapsed, Fix.Walk<Border>(focus.View.CameraHeaderButton).First(b => b.Name == "Ring").Visibility);
        });
    }

    [Theory]
    [InlineData("camera-collapsed")]
    [InlineData("camera-live")]
    [InlineData("camera-folded")]
    [InlineData("camera-watch-on")]
    [InlineData("camera-watch-stale")]
    [InlineData("camera-watch-folded")]
    public void N8_header_label_live_button_meta_and_chevron_never_overlap_and_nothing_trims(string state)
    {
        foreach (var dpi in new[] { 96, 144 })
        {
            var c = Sta.Run(() => Fix.Compose(state, dpi));
            Sta.Run(() =>
            {
                var gap = Theme.D("sp-base");
                var px = dpi == 96 ? 0.01 : 0.7; // one device pixel at 150% is 0.67 DIP
                var toggle = Bounds(c, c.View.CameraHeaderButton);
                var live = Bounds(c, c.View.CameraLiveButton);
                var title = Fix.Walk<TextBlock>(c.View.CameraHeaderButton).First(t => t.Text == "FRONT DOOR");
                var titleRight = Bounds(c, title).Left + Natural(title);
                var meta = (TextBlock)One(c.View, "camera-meta");
                var chev = One(c.View, "camera-chevron");
                Assert.True(toggle.Right <= live.Left + 0.01, $"toggle {toggle.Right} runs into the live button {live.Left}");
                Assert.Equal(c.View.ActualWidth - 1, live.Right, dpi == 96 ? 0.01 : 0.7); // the live button ends at the panel edge
                if (meta.Text.Length > 0)
                {
                    var m = Bounds(c, meta);
                    Assert.True(titleRight <= m.Left - gap + 0.01, $"label {titleRight} meta {m.Left}");
                    Assert.True(meta.ActualWidth >= Natural(meta) - 0.5, "meta is trimmed");
                    if (chev.Visibility == Visibility.Visible) Assert.True(m.Right <= Bounds(c, chev).Left + px);
                }
                if (chev.Visibility == Visibility.Visible) Assert.True(Bounds(c, chev).Right <= toggle.Right - gap + px);
                var lt = Fix.Walk<TextBlock>(c.View.CameraLiveButton).Single();
                Assert.True(lt.ActualWidth >= Natural(lt) - 0.5, "the live label is trimmed");
                Assert.True(Bounds(c, lt).Left >= live.Left + gap - px && Bounds(c, lt).Right <= live.Right - gap + px);
                Fix.Rec($"N8 title/meta/live ({state} {dpi})", $"title right {titleRight:0.#}, meta left {(meta.Text.Length > 0 ? Bounds(c, meta).Left : double.NaN):0.#}, toggle right {toggle.Right:0.#}, live {live.Left:0.#}-{live.Right:0.#}");
            });
        }
    }

    [Fact]
    public void Live_that_does_not_fit_folds_and_the_still_decides_for_itself()
    {
        var g = Fix.Load("camera-3-items");
        var live = Snapshot.ModelFor("camera-watch-on", g);
        var c = Sta.Run(() => Snapshot.Compose(live, 96));
        var without = Sta.Run(() => c.View.ActualHeight) - 212; // the window with no camera block
        // the still (207) fits with sp-lg to spare at this work height, Live (212) does not: while Live is on the camera folds last,
        // so the other sections fold first and Live fits; only when it still does not fit is Live ended (slice 2: PLAN-AMEND D10)
        // slice 5: VITALS (54) now folds before TODAY (56), so the story changes: VITALS folds first and TODAY stays open (158 fits 209);
        // TODAY folds only when VITALS alone is not enough (work + 170: limit 154, 102 fits); the old "not even Live fits" case (work + 165) now fits,
        // so it moves to work + 110 (limit 94, 102 > 94): the still folds and Live ends
        var work = without + 225;
        Sta.Run(() =>
        {
            c.View.Render(live with { WorkHeight = work });
            Assert.True(c.View.VitalsFolded);
            Assert.False(c.View.TodayFolded);
            Assert.False(c.View.CameraFolded);
            c.Host.UpdateLayout();
            Near("N10 Live kept, VITALS folded", without + 158, c.View.ActualHeight, 0.5);
            c.View.Render(live with { WorkHeight = without + 170 });
            Assert.True(c.View.VitalsFolded);
            Assert.True(c.View.TodayFolded);
            Assert.False(c.View.CameraFolded);
            c.Host.UpdateLayout();
            Near("N10 Live kept, VITALS and TODAY folded", without + 102, c.View.ActualHeight, 0.5);
            c.View.Render(live with { WorkHeight = without + 110 });
            Assert.True(c.View.CameraFolded); // not even Live with VITALS and TODAY folded fits (102 > 94): the still folds and Live ends
            var still = Snapshot.ModelFor("camera-live", g);
            c.View.Render(still with { WorkHeight = work });
            Assert.False(c.View.CameraFolded);
        });
        var fits = Sta.Run(() => { var s = Snapshot.ModelFor("camera-live", g); return Snapshot.Compose(s with { WorkHeight = work }, 96); });
        Sta.Run(() => Near("N10 still after the fold ended Live", without + 207, fits.View.ActualHeight, 0.5));
        Assert.True(Sta.Run(() => fits.View.ActualHeight) <= work - 16);
        Fix.Rec("N10 live fold", $"work {work:0.#}: Live folds, still fits at {without + 207:0.#}");
    }
}
