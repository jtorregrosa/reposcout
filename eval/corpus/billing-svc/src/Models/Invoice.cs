namespace Billing.Models;

public class Invoice
{
    public int Id { get; set; }
    public string CustomerId { get; set; } = "";
    public decimal Amount { get; set; }
    public bool Paid { get; set; }
    public string Status { get; set; } = "open";
    public DateTime IssuedAt { get; set; }
    public DateTime DueDate { get; set; }
}
