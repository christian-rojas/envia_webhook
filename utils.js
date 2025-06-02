// Add this near the top of your file, after the other requires
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
dotenv.config();

// Add these constants with your other environment variables
const ZOHO_EMAIL = process.env.ZOHO_EMAIL;
const ZOHO_PASSWORD = process.env.ZOHO_PASSWORD;

// Create the transporter
const transporter = nodemailer.createTransport({
  host: "smtp.zoho.com",
  port: 465,
  secure: true,
  auth: {
    user: ZOHO_EMAIL,
    pass: ZOHO_PASSWORD,
  },
});

// Add this function to send emails
async function sendOrderConfirmationEmail(order, data) {
  try {
    const mailOptions = {
      from: ZOHO_EMAIL,
      to: "christian.ici17@gmail.com",
      subject: `creacion de envio fallo - Order #${order}`,
      html: `
        <h1>${data}</h1>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.messageId);
    return info;
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
}

module.exports = {
  sendOrderConfirmationEmail,
};

const order = {
  order_number: "123456",
  customer: {
    first_name: "John",
    email: "christian.ici17@gmail.com",
  },
};

const trackingInfo = {
  tracking_number: "ABC123456789",
};

// call sendOrderConfirmationEmail
// sendOrderConfirmationEmail(order, trackingInfo)
//   .then(() => {
//     console.log("Email sent successfully");
//   })
//   .catch((error) => {
//     console.error("Error sending email:", error);
//   });
