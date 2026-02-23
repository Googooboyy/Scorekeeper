# Contact Form Setup

The contact form uses [Formspree](https://formspree.io) to send submissions to your email—no backend required.

## Setup (one-time)

1. Go to [formspree.io](https://formspree.io) and create a free account.
2. Click **New form** and give it a name (e.g. "The Scorekeeper Contact").
3. Copy your form ID from the form's URL: `https://formspree.io/f/YOUR_FORM_ID`
4. Open `contact.html` and replace `YOUR_FORM_ID` in the form's `action` attribute:
   ```html
   action="https://formspree.io/f/your-actual-form-id"
   ```

Submissions will be sent to the email you used for your Formspree account. The free tier includes 50 submissions per month.
