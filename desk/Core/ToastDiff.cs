namespace NightwatchDesk.Core;

public abstract record Click
{
    public sealed record OpenUrl(string Url) : Click;
    public sealed record ShowWidget : Click;
}

public sealed record Toast(string Title, string Text, Click Click);

public static class ToastDiff
{
    /// <summary>
    /// The one toast (or none) for a poll. <paramref name="prev"/> is the previous committed view, null before the first poll.
    /// <paramref name="firstRun"/> is true when state.json did not exist at start.
    /// </summary>
    public static Toast? Compute(View? prev, View next, string baseUrl, TimeZoneInfo tz, bool firstRun = false)
    {
        if (prev is null)
            return firstRun
                ? new Toast("Nightwatch Desk is running", "To keep its status in view, drag its icon from the ^ overflow onto the taskbar.", new Click.ShowWidget())
                : null;

        if (next is View.Offline o)
            return prev is View.Offline ? null : new Toast(
                "No answer from the box",
                (o.LastSuccess is { } t ? $"Last heard at {Copy.Clock(t, tz)}." : "Not heard from yet.") + " Nightwatch Desk keeps trying every 30 s.",
                new Click.ShowWidget());

        // Only a live glance can add things, and only against a baseline that had a glance.
        if (next is not View.Live live || GlanceOf(prev) is not { } before) return null;

        var seen = Keys(before).ToHashSet();
        var fresh = live.Glance.Lanes.Where(i => !seen.Contains(LaneKey(i)))
            .Concat(live.Glance.Items.Where(i => i.Severity == "bad" && !seen.Contains(ItemKey(i))))
            .ToList();
        if (fresh.Count == 0) return null;
        if (fresh.Count > 1)
            return new Toast(Copy.Trim($"{fresh.Count} new things need you", Copy.ToastTitleMax), Copy.Trim($"First: {fresh[0].Headline}", Copy.ToastTextMax), new Click.OpenUrl(baseUrl + "/"));

        var one = fresh[0];
        return new Toast(
            Copy.Trim(one.Headline, Copy.ToastTitleMax),
            Copy.Trim(one.Detail ?? one.Action ?? "Open nightwatch to see more.", Copy.ToastTextMax),
            new Click.OpenUrl(baseUrl + (one.Href.StartsWith('/') ? one.Href : "/")));
    }

    static Glance? GlanceOf(View v) => v switch
    {
        View.Live l => l.Glance,
        View.Stale s => s.Glance,
        View.Offline o => o.Glance,
        _ => null,
    };

    // The orchestra hit's id is constant, so a lane's identity also takes severity and headline.
    static string LaneKey(GlanceItem i) => $"L|{i.Id}|{i.Severity}|{i.Headline}";
    static string ItemKey(GlanceItem i) => $"I|{i.Id}|{i.Severity}";
    static IEnumerable<string> Keys(Glance g) => g.Lanes.Select(LaneKey).Concat(g.Items.Select(ItemKey));
}
