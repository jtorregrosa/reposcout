using System.Security.Claims;
using Billing.Data;
using Billing.Models;
using Billing.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Billing.Controllers;

// Customers see their own invoices; staff use the back office, not this API.
[ApiController]
[Authorize]
[Route("api/invoices")]
public class InvoiceController : ControllerBase
{
    private readonly InvoiceRepository _repository;
    private readonly InvoiceService _service;

    public InvoiceController(InvoiceRepository repository, InvoiceService service)
    {
        _repository = repository;
        _service = service;
    }

    private string CustomerId => User.FindFirstValue(ClaimTypes.NameIdentifier)!;

    [HttpGet("{id:int}")]
    public async Task<ActionResult<Invoice>> Get(int id)
    {
        var invoice = await _repository.FindAsync(id);
        if (invoice is null) return NotFound();
        return invoice;
    }

    [HttpGet("mine")]
    public async Task<ActionResult<IReadOnlyList<Invoice>>> Mine([FromQuery] string? status)
    {
        return Ok(await _service.ForCustomerAsync(CustomerId, status));
    }

    [HttpGet("balance")]
    public async Task<ActionResult<decimal>> Balance()
    {
        return Ok(await _service.BalanceAsync(CustomerId));
    }

    [HttpGet("{id:int}/late-fee")]
    public async Task<ActionResult<decimal>> LateFee(int id)
    {
        var invoice = await _repository.FindAsync(id);
        if (invoice is null || invoice.CustomerId != CustomerId) return NotFound();
        return Ok(_service.LateFee(invoice, DateTime.UtcNow));
    }
}
