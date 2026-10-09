using Billing.Models;
using Microsoft.EntityFrameworkCore;

namespace Billing.Data;

public class BillingContext : DbContext
{
    public BillingContext(DbContextOptions<BillingContext> options)
        : base(options) { }

    public DbSet<Invoice> Invoices => Set<Invoice>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Invoice>().HasIndex(i => i.CustomerId);
        modelBuilder.Entity<Invoice>().Property(i => i.Amount).HasPrecision(18, 2);
    }
}
