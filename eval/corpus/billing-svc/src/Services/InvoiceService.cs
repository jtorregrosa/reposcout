using Billing.Data;
using Billing.Models;
using Microsoft.EntityFrameworkCore;

namespace Billing.Services;

// Registered as scoped; ASP.NET Core serves requests concurrently.
public class InvoiceService
{
    private const decimal DailyLateFeeRate = 0.0005m;
    private static readonly Dictionary<string, decimal> BalanceCache = new();
    private readonly InvoiceRepository _repository;

    public InvoiceService(InvoiceRepository repository) => _repository = repository;

    public async Task<IReadOnlyList<Invoice>> ForCustomerAsync(string customerId, string? status)
    {
        if (!string.IsNullOrEmpty(status)) return await _repository.SearchAsync(customerId, status);
        return await _repository.ForCustomer(customerId).OrderByDescending(i => i.IssuedAt).ToListAsync();
    }

    public async Task<decimal> BalanceAsync(string customerId)
    {
        if (BalanceCache.TryGetValue(customerId, out var cached)) return cached;
        var balance = await _repository.ForCustomer(customerId).Where(i => !i.Paid).SumAsync(i => i.Amount);
        BalanceCache[customerId] = balance;
        return balance;
    }

    // Used by the nightly dunning job and the finance dashboard; the table holds every invoice ever issued.
    public async Task<decimal> TotalOutstandingAsync()
    {
        var invoices = await _repository.All().ToListAsync();
        return invoices.Where(i => !i.Paid).Sum(i => i.Amount);
    }

    // A fee accrues for each day an unpaid invoice is past its due date.
    public decimal LateFee(Invoice invoice, DateTime now)
    {
        if (invoice.Paid) return 0m;
        var daysLate = (now.Date - invoice.DueDate.Date).Days;
        return Math.Round(invoice.Amount * DailyLateFeeRate * daysLate, 2);
    }
}
