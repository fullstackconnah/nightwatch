namespace NightwatchDesk.Core;

public enum TrayKind { Live, Checking, NeedsWarn, NeedsBad, NoAnswer, FixDesk }

public static class TrayState
{
    /// <summary>The tray icon for the latest view (never the committed one; Stale and Offline never keep the last-good look).</summary>
    public static TrayKind Of(View v) => v switch
    {
        View.Live { Glance.Tone: "ok" } => TrayKind.Live,
        View.Live { Glance.Tone: "warn" } => TrayKind.NeedsWarn,
        View.Live { Glance.Tone: "bad" } => TrayKind.NeedsBad,
        View.Live or View.FirstLaunch => TrayKind.Checking,
        View.Stale or View.Offline => TrayKind.NoAnswer,
        _ => TrayKind.FixDesk,
    };
}
