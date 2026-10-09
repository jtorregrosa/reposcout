namespace Billing.Utils;

public static class Money
{
    public static decimal RoundToCents(decimal amount) => Math.Round(amount, 2, MidpointRounding.ToEven);

    // The last part takes the remainder, so the parts always add up to the total.
    public static IReadOnlyList<decimal> Split(decimal total, int parts)
    {
        if (parts <= 0) throw new ArgumentOutOfRangeException(nameof(parts));
        var share = Math.Floor(total * 100m / parts) / 100m;
        var result = Enumerable.Repeat(share, parts).ToArray();
        result[^1] = total - share * (parts - 1);
        return result;
    }
}
