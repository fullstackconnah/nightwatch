namespace NightwatchDesk.Core;

/// <summary>
/// The no-jitter gate (SHAPE "No jitter"). The window shows <see cref="Committed"/>; a poll that would move rows,
/// order, the answer text or the height waits in <see cref="Pending"/> while the gate is held.
/// </summary>
public sealed class Gate
{
    public static readonly TimeSpan StillAfter = TimeSpan.FromSeconds(30);

    readonly Func<DateTimeOffset> clock;
    bool pointer, focus, menu;
    DateTimeOffset lastInput;

    public Gate(Func<DateTimeOffset> clock)
    {
        this.clock = clock;
        lastInput = clock();
    }

    public View? Committed { get; private set; }
    /// <summary>The newest view, committed or not. Footer and the dim restyle read this: they move nothing.</summary>
    public View? Latest { get; private set; }
    public bool UpdateHeld => Pending is not null;
    View? Pending { get; set; }

    /// <summary>Pointer over the window, keyboard focus inside it, or the context menu open; and not parked for 30 s.</summary>
    public bool Held => (pointer || focus || menu) && clock() - lastInput < StillAfter;

    /// <summary>True when <see cref="Committed"/> changed.</summary>
    public bool Offer(View latest)
    {
        Latest = latest;
        if (Committed is null || !Held || Sig(latest) == Sig(Committed))
        {
            Pending = null;
            var changed = !ReferenceEquals(Committed, latest);
            Committed = latest;
            return changed;
        }
        Pending = latest;
        return false;
    }

    /// <summary>Records a pointer move or key press, which restarts the 30 s still-pointer clock.</summary>
    public void Touch() => lastInput = clock();

    public bool SetPointer(bool over) { pointer = over; Touch(); return Release(); }
    public bool SetFocus(bool inside) { focus = inside; Touch(); return Release(); }
    public bool SetMenu(bool open) { menu = open; Touch(); return Release(); }

    /// <summary>Commits the waiting view once nothing holds the gate any more (also called on the timer).</summary>
    public bool Release()
    {
        if (Pending is null || Held) return false;
        Committed = Pending;
        Pending = null;
        return true;
    }

    /// <summary>What moves on screen. Vitals, the footer and dot styling are left out on purpose: they are live while held.</summary>
    public static string Sig(View v)
    {
        static string Row(GlanceItem i) => $"{i.Id}|{i.Severity}|{i.Headline}|{i.Detail}|{i.Action}|{i.Since}|{i.Href}";
        var g = v switch { View.Live l => l.Glance, View.Stale s => s.Glance, View.Offline o => o.Glance, _ => null };
        var rows = g is not null
            ?string.Join("\n", g.Lanes.Select(Row)) + "\n--\n" + string.Join("\n", g.Items.Select(Row))
            : "";
        return Copy.Head(v) + "\n" + Copy.Note(v) + "\n" + rows;
    }
}
