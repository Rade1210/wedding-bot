const functions = require("firebase-functions");
const express = require("express");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");

// Initialize Firebase Admin automatically using environment credentials
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

const db = admin.firestore();
const app = express();
app.use(bodyParser.json());

// Webhook endpoint
app.post("/", async (req, res) => {
  try {
    const sessionInfo = req.body.sessionInfo.parameters;
    const dressType = sessionInfo.dress_type;
    const dressSize = Number(sessionInfo.dress_size);
    const minPrice = Number(sessionInfo.dress_min_price);
    const maxPrice = Number(sessionInfo.dress_max_price);

    const snapshot = await db.collection("dresses").get();
    const matchingDresses = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      const inRange = data.price >= minPrice && data.price <= maxPrice;
      const typeMatch = data.type.toLowerCase() === dressType.toLowerCase();
      const sizeMatch = data.size_available.includes(dressSize);
      const inStock = data.in_stock === true;

      if (inRange && typeMatch && sizeMatch && inStock) {
        matchingDresses.push({
          name: data.name,
          price: data.price,
          description: data.description,
          image_url: data.image_url,
        });
      }
    });

    let responseText;
    if (matchingDresses.length === 0) {
      responseText = "I couldn’t find any dresses that match your criteria. Would you like to adjust your search?";
    } else {
      responseText = "Here are some dresses that match your preferences:\n";
      matchingDresses.forEach(dress => {
        responseText += `\n👗 ${dress.name} - $${dress.price}\n${dress.description}\nImage: ${dress.image_url}\n`;
      });
    }

    // Send response to Dialogflow CX
    res.json({
      fulfillment_response: {
        messages: [
          { text: { text: [responseText] } }
        ]
      }
    });

  } catch (error) {
    console.error("Webhook error:", error);
    res.json({
      fulfillment_response: {
        messages: [
          { text: { text: ["Sorry, something went wrong while fetching the dresses."] } }
        ]
      }
    });
  }
});

// Export the webhook as a Firebase Function
exports.webhook = functions.https.onRequest(app);
