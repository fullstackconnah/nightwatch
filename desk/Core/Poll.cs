namespace NightwatchDesk.Core;

public static class Poll
{
    /// <summary>Maps an HTTP reply onto the state machine's input. 401 and 503 are replies, not failures; anything else but 200 is a failure.</summary>
    public static Outcome Map(int status, string body) => status switch
    {
        200 => GlanceParser.Parse(body),
        401 => new Outcome.Unauthorized(),
        503 => new Outcome.Off(),
        _ => new Outcome.Failed(),
    };
}
