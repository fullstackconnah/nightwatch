using NightwatchDesk.Core;

namespace Core.Tests;

public class ToastTests
{
    static readonly TimeZoneInfo Tz = TimeZoneInfo.CreateCustomTimeZone("t", TimeSpan.FromHours(10), "t", "t");
    static readonly DateTimeOffset T0 = new(2026, 1, 1, 4, 5, 0, TimeSpan.Zero); // 14:05 in Tz
    const string Base = "http://h.local:3005";

    static GlanceItem Item(string id, string sev = "warn", string head = "H", string? detail = "D", string? action = null, string href = "/x")
        => new(id, sev, head, detail, action, null, href);
    static View.Live Live(GlanceItem[]? lanes = null, GlanceItem[]? items = null)
        => new(GlanceTests.Golden() with { Lanes = lanes ?? [], Items = items ?? [] });
    static Toast? Diff(View? prev, View next, bool firstRun = false) => ToastDiff.Compute(prev, next, Base, Tz, firstRun);

    [Fact]
    public void First_poll_never_toasts_even_with_items()
        => Assert.Null(Diff(null, Live(items: [Item("a", "bad")])));

    [Fact]
    public void Poll_after_a_view_with_no_glance_adopts_silently()
        => Assert.Null(Diff(new View.FirstLaunch(), Live(items: [Item("a", "bad")])));

    [Fact]
    public void New_lane_item_toasts_with_its_detail_and_a_link()
    {
        var lane = Item("orchestra:orchestra", "warn", "dev-lead is waiting for you", "Usually a permission prompt", href: "/orchestrators");
        var t = Diff(Live(), Live(lanes: [lane]));
        Assert.Equal(new Toast("dev-lead is waiting for you", "Usually a permission prompt", new Click.OpenUrl(Base + "/orchestrators")), t);
    }

    [Fact]
    public void Toast_text_falls_back_to_action_then_a_generic_line()
    {
        Assert.Equal("Do this", Diff(Live(), Live(items: [Item("a", "bad", detail: null, action: "Do this")]))!.Text);
        Assert.Equal("Open nightwatch to see more.", Diff(Live(), Live(items: [Item("a", "bad", detail: null)]))!.Text);
    }

    [Fact]
    public void Lane_identity_includes_severity_and_headline()
    {
        var a = Item("orchestra:orchestra", "warn", "one", href: "/orchestrators");
        Assert.Null(Diff(Live(lanes: [a]), Live(lanes: [a])));
        Assert.NotNull(Diff(Live(lanes: [a]), Live(lanes: [a with { Headline = "two" }])));
        Assert.NotNull(Diff(Live(lanes: [a]), Live(lanes: [a with { Severity = "bad" }])));
    }

    [Fact]
    public void New_bad_item_toasts_but_new_warn_item_does_not()
    {
        Assert.NotNull(Diff(Live(), Live(items: [Item("a", "bad")])));
        Assert.Null(Diff(Live(), Live(items: [Item("a", "warn")])));
    }

    [Fact]
    public void Same_item_does_not_toast_again_but_returns_after_clearing()
    {
        var bad = Item("a", "bad");
        Assert.Null(Diff(Live(items: [bad]), Live(items: [bad])));
        Assert.Null(Diff(Live(items: [bad]), Live()));
        Assert.NotNull(Diff(Live(), Live(items: [bad])));
    }

    [Fact]
    public void A_warn_item_escalating_to_bad_toasts()
        => Assert.NotNull(Diff(Live(items: [Item("a", "warn")]), Live(items: [Item("a", "bad")])));

    [Fact]
    public void Several_new_collapse_to_one_toast_lanes_first()
    {
        var lane = Item("orchestra:orchestra", "warn", "lane headline", href: "/orchestrators");
        var t = Diff(Live(), Live(lanes: [lane], items: [Item("a", "bad", "disk"), Item("b", "bad", "mount")]));
        Assert.Equal(new Toast("3 new things need you", "First: lane headline", new Click.OpenUrl(Base + "/")), t);
    }

    [Fact]
    public void Recovery_and_stale_and_client_errors_do_not_toast()
    {
        var bad = Item("a", "bad");
        Assert.Null(Diff(Live(items: [bad]), Live()));
        Assert.Null(Diff(Live(items: [bad]), new View.Stale(Live(items: [bad]).Glance, T0)));
        Assert.Null(Diff(Live(items: [bad]), new View.WrongToken(T0)));
        Assert.Null(Diff(Live(items: [bad]), new View.Config(new ConfigResult.Missing())));
        Assert.Null(Diff(Live(items: [bad]), new View.ServerTooNew(2)));
    }

    [Fact]
    public void Items_that_survive_an_offline_spell_do_not_toast_on_recovery()
    {
        var g = Live(items: [Item("a", "bad")]).Glance;
        Assert.Null(Diff(new View.Offline(g, T0), new View.Live(g)));
    }

    [Fact]
    public void Offline_toasts_once_on_entering_it()
    {
        var g = Live().Glance;
        var t = Diff(new View.Stale(g, T0), new View.Offline(g, T0));
        Assert.Equal(new Toast("No answer from the box", "Last heard at 14:05. Nightwatch Desk keeps trying every 30 s.", new Click.ShowWidget()), t);
        Assert.Null(Diff(new View.Offline(g, T0), new View.Offline(g, T0)));
    }

    [Fact]
    public void First_launch_toasts_once_ever_via_the_flag_on_the_first_poll()
    {
        var t = Diff(null, Live(), firstRun: true);
        Assert.Equal(new Toast("Nightwatch Desk is running", "To keep its status in view, drag its icon from the ^ overflow onto the taskbar.", new Click.ShowWidget()), t);
        Assert.Null(Diff(Live(), Live(), firstRun: true));
    }

    [Fact]
    public void Title_and_text_are_trimmed_to_63_and_255()
    {
        var t = Diff(Live(), Live(items: [Item("a", "bad", new string('h', 100), new string('d', 400))]))!;
        Assert.Equal(63, t.Title.Length);
        Assert.Equal(255, t.Text.Length);
        Assert.EndsWith("…", t.Title);
        Assert.EndsWith("…", t.Text);
    }

    [Fact]
    public void A_href_without_a_leading_slash_opens_the_root()
        => Assert.Equal(new Click.OpenUrl(Base + "/"), Diff(Live(), Live(items: [Item("a", "bad", href: "#backup")]))!.Click);
}
