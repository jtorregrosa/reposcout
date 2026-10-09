using Billing.Models;
using Microsoft.EntityFrameworkCore;

namespace Billing.Data;

public class InvoiceRepository
{
    private readonly BillingContext _db;

    public InvoiceRepository(BillingContext db) => _db = db;

    public Task<Invoice?> FindAsync(int id) => _db.Invoices.FirstOrDefaultAsync(i => i.Id == id);

    public IQueryable<Invoice> All() => _db.Invoices;

    public IQueryable<Invoice> ForCustomer(string customerId) => _db.Invoices.Where(i => i.CustomerId == customerId);

    // status comes from the query string of GET api/invoices/mine.
    public Task<List<Invoice>> SearchAsync(string customerId, string status) =>
        _db.Invoices.FromSqlRaw($"SELECT * FROM Invoices WHERE CustomerId = '{customerId}' AND Status = '{status}'").ToListAsync();
}
