# Custom Domain Setup Guide

## The Problem

Right now your application URL looks like this:
```
https://mra-mines-alb-dev-1694814850.eu-west-2.elb.amazonaws.com
```

This works fine at home, but:
- Your corporate network blocks it (self-signed certificate issue)
- Browsers show security warnings
- It's hard to remember and share

After setting up a custom domain, you'll have something like:
```
https://maps.yourcompany.com
```

This works everywhere, no warnings, looks professional.

**Cost:** About £10-13 per year for the domain. The SSL certificate is free from AWS.

---

## What You Need

- AWS account with admin access
- About 2-4 hours (most of it is waiting for DNS)
- A domain name (either register a new one or use your company's)
- Credit card if registering a new domain

---

## The Process

There are 5 steps:
1. Get a domain name (30 minutes)
2. Request an SSL certificate (5 minutes)
3. Wait for certificate validation (30 mins - 2 hours)
4. Connect everything (1 hour - coordinate with DevOps)
5. Test it works (15 minutes)

---

## Step 1: Get a Domain Name

You have two options here.

### Option A: Register a New Domain

If you don't have a domain yet:

1. Log into AWS Console
2. Go to Route 53 (search for it in the top search bar)
3. Click "Registered domains" in the left menu
4. Click "Register domain"
5. Type your desired name (like `mra-mines`) and click Check
6. If available, select it. Common options:
   - .com domains: ~£11/year
   - .co.uk domains: ~£9/year
7. Fill in your contact details
8. Enable auto-renewal (recommended)
9. Complete the purchase

Wait 5-10 minutes for it to register. Then:
- Go to "Hosted zones" in Route 53
- Find your domain
- Write down the "Hosted Zone ID" - you'll need this later

### Option B: Use Your Company Domain

If your company already has a domain:

1. Contact your IT department
2. Request a subdomain like `maps.yourcompany.com`
3. They'll either:
   - Give you access to create it yourself in AWS
   - Create it for you and send you the details

Once it's set up:
- Go to Route 53 → Hosted zones
- Find your subdomain
- Write down the "Hosted Zone ID"

---

## Step 2: Request SSL Certificate

This is the certificate that makes your site secure (the padlock in the browser).

**Important:** Make sure you're in the eu-west-2 (London) region. Check the top-right corner of AWS Console.

1. Go to Certificate Manager (search for it)
2. Click "Request" button
3. Select "Request a public certificate"
4. Enter your domain name:
   - If you registered `example.com`, add both `example.com` and `www.example.com`
   - If using a subdomain, just add `maps.yourcompany.com`
5. Choose "DNS validation"
6. Click "Request"

You'll see a certificate with status "Pending validation". Copy the ARN (starts with `arn:aws:acm:...`) - you'll need this later.

---

## Step 3: Validate the Certificate

AWS needs to verify you own the domain.

1. Click on your certificate
2. Scroll to the "Domains" section
3. Click "Create records in Route 53"
4. Click "Create records" in the popup

That's it. AWS will automatically add the verification records to your DNS.

Now wait. The status will change from "Pending validation" to "Issued". This usually takes 5-30 minutes, but can take up to 2 hours.

Keep refreshing the page until it says "Issued".

---

## Step 4: Connect to Your Application

This is where you need to coordinate with your DevOps team.

Gather this information first:
```
Domain Name: _______________________
Hosted Zone ID: ____________________
Certificate ARN: ___________________
```

Send an email to whoever manages your infrastructure:

```
Hi [Name],

Can you configure the MRA Mines app with this custom domain?

Domain: maps.yourcompany.com
Zone ID: Z1234ABC... (from Route 53)
Certificate: arn:aws:acm:eu-west-2:... (from Certificate Manager)

The certificate shows "Issued" status in ACM.

Thanks
```

They'll need to:
- Update Terraform configuration
- Run deployment (takes about 15 minutes)
- Verify it's working

---

## Step 5: Test Everything

Once your DevOps team says it's deployed:

### Check DNS

Open Command Prompt or Terminal:
```bash
nslookup maps.yourcompany.com
```

You should see an IP address. If you get "can't find", wait 30 minutes and try again (DNS propagation).

### Check the Website

1. Open a browser
2. Go to `https://maps.yourcompany.com` (use your actual domain)
3. Look for the padlock icon - it should be closed/secure
4. No security warnings should appear
5. Try logging in

### Check Certificate

Click the padlock icon, then "Certificate". Verify:
- Issued to: Your domain name
- Issued by: Amazon
- Valid until: A date about 13 months from now

### Test on Corporate Network

Connect to your company VPN/network and try accessing it. Should work fine now.

---

## Common Problems

**"Website not found"**
- DNS hasn't propagated yet. Can take up to 48 hours but usually much faster.
- Check https://dnschecker.org/ to see propagation status

**Certificate warning appears**
- Make sure you're using https:// not http://
- Make sure you're using the new domain, not the old AWS URL
- Try incognito/private browsing
- Clear your browser cache

**Certificate stuck on "Pending validation"**
- Go back to Certificate Manager
- Check if DNS records exist in Route 53
- Try clicking "Create records in Route 53" again
- If stuck after 24 hours, delete and start over

**Can load site but can't login**
- DevOps needs to verify Cognito callback URLs include your new domain

---

## Costs

**One-time:**
- Domain registration: £10-13/year

**Ongoing:**
- SSL certificate: Free
- Route 53 hosted zone: About £0.40/month
- Route 53 DNS queries: About £0.30/month

Everything else (load balancer, etc.) costs the same as before.

**Total new cost: ~£1 per year plus domain registration**

---

## Maintenance

The SSL certificate auto-renews for free. You don't need to do anything.

If you enabled auto-renewal for the domain, it'll renew automatically too. Just keep your payment method valid.

If you didn't enable auto-renewal, AWS will email you 60 days before expiry as a reminder.

---

## Important Info to Save

Write these down somewhere safe:

```
Application URL: https://maps.yourcompany.com
AWS Region: eu-west-2
Hosted Zone ID: [Your ID]
Certificate ARN: [Your ARN]
Domain Renewal Date: [Date]
```

---

## Getting Help

**AWS Issues:**
- Route 53: https://console.aws.amazon.com/route53/
- Certificate Manager: https://console.aws.amazon.com/acm/home?region=eu-west-2

**Application Issues:**
- Contact your DevOps team

**Useful Tools:**
- DNS checker: https://dnschecker.org/
- SSL checker: https://www.ssllabs.com/ssltest/

---

For technical implementation details, see `CUSTOM_DOMAIN_SETUP.md` (for DevOps team).

Last updated: 2025-11-11
