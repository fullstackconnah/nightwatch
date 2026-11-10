using System.Net.Http;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using NightwatchDesk.Core;

namespace NightwatchDesk.App.Tests;

public class LimitsAndSecretsTests
{
    const string Canary = "tok_SECRET_CANARY_9f3a1c";
    static readonly TimeZoneInfo Utc = TimeZoneInfo.Utc;

    static Glance Long400()
    {
        var g = Fix.Load("lanes-and-items");
        var big = new string('w', 400);
        return g with { Answer = big, Lanes = g.Lanes.Select(l => l with { Headline = big, Detail = big }).ToArray() };
    }

    [Fact]
    public void N19_notifyicon_text_limit_probe()
    {
        // .NET (Core) NotifyIcon.Text: 127 allowed, 128 throws. Verified here, not assumed.
        var results = new List<string>();
        foreach (var n in new[] { 63, 64, 127, 128 })
        {
            try { using var ni = new System.Windows.Forms.NotifyIcon { Text = new string('a', n) }; results.Add($"{n}=ok"); }
            catch (ArgumentOutOfRangeException) { results.Add($"{n}=throws"); }
        }
        Fix.Rec("N19 NotifyIcon.Text probe", string.Join(" ", results));
        Assert.Contains("127=ok", results);
        Assert.Contains("128=throws", results);
    }

    [Fact]
    public void N19_strings_stay_inside_the_limits_for_a_400_character_answer()
    {
        var g = Long400();
        var views = new View[] { new View.Live(g), new View.Stale(g, DateTimeOffset.UnixEpoch), new View.Offline(g, DateTimeOffset.UnixEpoch), new View.FirstLaunch() };
        var worst = 0;
        foreach (var v in views)
        {
            var t = Copy.Tooltip(v, Utc);
            worst = Math.Max(worst, t.Length);
            Assert.True(t.Length <= Copy.TooltipMax, t.Length.ToString());
        }
        var toast = ToastDiff.Compute(new View.Live(Fix.Load("healthy")), new View.Live(g), "http://homelab.local:3005", Utc);
        Assert.NotNull(toast);
        var title = Copy.Trim(toast!.Title, Copy.ToastTitleMax);
        var text = Copy.Trim(toast.Text, Copy.ToastTextMax);
        Fix.Rec("N19 longest tooltip / toast title / toast text", $"{worst} / {title.Length} / {text.Length}");
        Assert.True(title.Length <= 63 && text.Length <= 255);
        Sta.Run(() => Fix.Compose("long-copy")); // a 140+ character answer renders without throwing
        Sta.Run(() => Snapshot.Compose(new Model(new View.Live(g), new View.Live(g), false), 96)); // and so does 400
    }

    [Fact]
    public void N20_the_token_is_in_no_text_tooltip_or_automation_name()
    {
        var ok = new ConfigResult.Ok("http://homelab.local:3005", Canary);
        Assert.DoesNotContain(Canary, ok.ToString());
        var hits = new List<string>();
        foreach (var s in Snapshot.States)
        {
            var c = Sta.Run(() => Fix.Compose(s));
            Sta.Run(() =>
            {
                foreach (var e in Fix.Walk<FrameworkElement>(c.View))
                {
                    var bag = new List<string> { AutomationProperties.GetName(e), AutomationProperties.GetHelpText(e), e.ToolTip?.ToString() ?? "" };
                    if (e is TextBlock t) bag.Add(t.Text);
                    if (bag.Any(x => x.Contains(Canary))) hits.Add(s);
                }
            });
        }
        // The one place a token touches the network: an unreachable host must not leak it through the outcome.
        using var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(2) };
        var o = Poller.FetchAsync(http, new ConfigResult.Ok("http://127.0.0.1:1", Canary)).GetAwaiter().GetResult();
        Assert.IsType<Outcome.Failed>(o);
        Assert.DoesNotContain(Canary, o.ToString());
        Assert.DoesNotContain(Canary, Copy.Head(new DeskState(() => DateTimeOffset.UnixEpoch).Apply(o)));
        Fix.Rec("N20 canary hits across 20 states", hits.Count.ToString());
        Assert.Empty(hits);
    }
}
