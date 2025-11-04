const functions = require("firebase-functions");
const express = require("express");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");

// Initialize Firebase Admin SDK
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

    let messages;
    if (matchingDresses.length === 0) {
      messages = [
        {
          text: { text: ["I couldn’t find any dresses that match your criteria. Would you like to adjust your search?"] }
        }
      ];
    } else {
      // Build rich content cards with numbers and selection buttons
      const richContent = matchingDresses.map((dress, index) => [
        {
          type: "image",
          rawUrl: dress.image_url,
          accessibilityText: dress.name
        },
        {
          type: "info",
          title: `${index + 1}️⃣ ${dress.name}`, // Numbered title
          subtitle: `Price: $${dress.price}\n${dress.description}`,
          actionLink: "",
          button: [
            {
              text: "Select this Dress",
              postback: dress.name
            }
          ]
        }
      ]);

      messages = [
        {
          payload: {
            richContent: richContent
          }
        }
      ];
    }

    // Send response to Dialogflow CX
    res.json({
      fulfillment_response: { messages: messages }
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
