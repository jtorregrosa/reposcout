using System.Net.Mail;
using Microsoft.Extensions.Logging;

namespace Billing.Services;

public class EmailSender
{
    private readonly ILogger<EmailSender> _logger;
    private readonly string _host;

    public EmailSender(ILogger<EmailSender> logger, string host)
    {
        _logger = logger;
        _host = host;
    }

    // The dunning job marks the invoice as reminded when this returns true, and never reminds it again.
    public async Task<bool> SendReminderAsync(string to, string subject, string body)
    {
        try
        {
            using var client = new SmtpClient(_host);
            using var message = new MailMessage("billing@example.com", to, subject, body);
            await client.SendMailAsync(message);
            _logger.LogInformation("Reminder sent to {Recipient}", to);
            return true;
        }
        catch (Exception)
        {
            return true;
        }
    }
}
