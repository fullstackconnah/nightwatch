namespace NightwatchDesk.Core;

/// <summary>What the desk should show. Client-error views carry no kept glance on purpose.</summary>
public abstract record View
{
    public sealed record FirstLaunch : View;
    public sealed record Live(Glance Glance) : View;
    /// <summary>LastSuccess is client time.</summary>
    public sealed record Stale(Glance? Glance, DateTimeOffset? LastSuccess) : View;
    public sealed record Offline(Glance? Glance, DateTimeOffset? LastSuccess) : View;
    public sealed record Config(ConfigResult Kind) : View;
    public sealed record WrongToken(DateTimeOffset At) : View;
    public sealed record DeskOff(DateTimeOffset At) : View;
    public sealed record ServerTooNew(int V) : View;
}

/// <summary>The poll state machine. No timers or HTTP: feed it outcomes, read <see cref="Current"/>.</summary>
public sealed class DeskState
{
    public static readonly TimeSpan StaleAfter = TimeSpan.FromSeconds(90);
    public const int OfflineAfterFailures = 3;

    readonly Func<DateTimeOffset> clock;
    readonly DateTimeOffset started;
    Glance? glance;
    DateTimeOffset? lastSuccess;
    int failures;
    View? clientError; // WrongToken, DeskOff or ServerTooNew
    ConfigResult? configError;

    public DeskState(Func<DateTimeOffset> clock)
    {
        this.clock = clock;
        started = clock();
    }

    /// <summary>Re-evaluated on every read, so Stale appears as time passes with no new poll.</summary>
    public View Current
    {
        get
        {
            if (configError is not null) return new View.Config(configError);
            if (clientError is not null) return clientError;
            if (failures >= OfflineAfterFailures) return new View.Offline(glance, lastSuccess);
            var since = lastSuccess ?? started;
            if (clock() - since >= StaleAfter) return new View.Stale(glance, lastSuccess);
            return glance is null ? new View.FirstLaunch() : new View.Live(glance);
        }
    }

    public void SetConfig(ConfigResult r) => configError = r is ConfigResult.Ok ? null : r;

    public View Apply(Outcome o)
    {
        switch (o)
        {
            case Outcome.Ok ok:
                failures = 0; clientError = null; glance = ok.Glance; lastSuccess = clock();
                break;
            case Outcome.Failed:
                failures++; clientError = null;
                break;
            default: // a reply from the box, so not a failure; its data (if any) is no longer trusted
                failures = 0; glance = null; lastSuccess = null;
                clientError = o switch
                {
                    Outcome.Unauthorized => new View.WrongToken(clock()),
                    Outcome.Off => new View.DeskOff(clock()),
                    Outcome.TooNew t => new View.ServerTooNew(t.V),
                    _ => null,
                };
                break;
        }
        return Current;
    }
}
