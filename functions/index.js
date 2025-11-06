const functions = require("firebase-functions");
const express = require("express");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");

// Firebase Admin initialization
if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();

// --------------- FIND DRESS WEBHOOK ---------------
const findApp = express();
findApp.use(bodyParser.json());

findApp.post("/", async (req, res) => {
  try {
    const params = req.body.sessionInfo.parameters;
    const dressType = params.dress_type;
    const dressSize = Number(params.dress_size);
    const minPrice = Number(params.dress_min_price);
    const maxPrice = Number(params.dress_max_price);

    // Logging incoming params
    console.log("FIND_DRESS INPUT PARAMS:", JSON.stringify(params, null, 2));

    const snapshot = await db.collection("dresses").get();
    const matchingDresses = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      const inRange = data.price >= minPrice && data.price <= maxPrice;
      const typeMatch = data.type && data.type.toLowerCase() === dressType.toLowerCase();
      const sizeMatch = data.size_available && data.size_available.includes(dressSize);
      const inStock = !!data.in_stock;
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
          text: { text: ["I couldn’t find any dresses matching your criteria. Would you like to adjust your search?"] }
        }
      ];
    } else {
      // Each card is an array of image/info objects as required by Dialogflow Messenger richContent
      const richContent = matchingDresses.map((dress, idx) => [
        {
          type: "image",
          rawUrl: dress.image_url,
          accessibilityText: dress.name
        },
        {
          type: "info",
          title: `${idx + 1}️⃣ ${dress.name}`,
          subtitle: `Price: $${dress.price}\n${dress.description}`,
          buttons: [
            {
              text: "Select this Dress",
              event: {
                name: "select-dress", // This event should map to your 'Select Dress' intent/route
                languageCode: "",
                parameters: { selectedNumber: idx + 1 } // Use correct case!
              }
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

    // Ensure matchingDresses is passed as a session parameter for the select intent
    res.json({
      sessionInfo: { parameters: { ...params, matchingDresses } },
      fulfillment_response: { messages }
    });

  } catch (error) {
    console.error("FindWeddingDress Webhook error:", error);
    res.json({
      fulfillment_response: {
        messages: [{ text: { text: ["Sorry, something went wrong while fetching the dresses."] } }]
      }
    });
  }
});
exports.findWeddingDressWebhook = functions.https.onRequest(findApp);

// --------------- SELECT DRESS WEBHOOK - MULTIPLE SELECTIONS ---------------
const selectApp = express();
selectApp.use(bodyParser.json());

selectApp.post("/", async (req, res) => {
  try {
    const params = req.body.sessionInfo.parameters;
    console.log("SELECT_DRESS INPUT PARAMS:", JSON.stringify(params, null, 2));
    
    // Accept both camelCase and lowercase for selectedNumbers
    let selectedNumbers = params.selectedNumbers || params.selectednumbers;
    if (!selectedNumbers) {
      // Backward-compat: try single number parameter
      selectedNumbers = params.selectedNumber || params.selectednumber;
    }
    // Always treat as array (even if only one number provided)
    if (!Array.isArray(selectedNumbers)) {
      selectedNumbers = [selectedNumbers];
    }
    // Convert all to numbers and filter out invalid values
    selectedNumbers = selectedNumbers.map(Number).filter(n => !isNaN(n));

    const matchingDresses = params.matchingDresses || [];

    if (!Array.isArray(matchingDresses) || matchingDresses.length === 0) {
      return res.json({
        fulfillment_response: {
          messages: [
            { text: { text: ["Sorry, I couldn't find the dresses you previously viewed. Please search again!"] } }
          ]
        }
      });
    }

    // Validate and collect all selected dresses (1-based to 0-based index)
    const selectedDresses = [];
    for (const num of selectedNumbers) {
      if (num >= 1 && num <= matchingDresses.length) {
        selectedDresses.push(matchingDresses[num - 1]);
      }
    }

    if (!selectedDresses.length) {
      return res.json({
        fulfillment_response: {
          messages: [
            { text: { text: ["Those numbers don't match any dresses in the list, please try again!"] } }
          ]
        }
      });
    }

    // Build list of selected dresses as cards
    const selectedDressCards = selectedDresses.map(dress => ([
      {
        type: "image",
        rawUrl: dress.image_url,
        accessibilityText: dress.name
      },
      {
        type: "info",
        title: dress.name,
        subtitle: `Price: $${dress.price}\n${dress.description}`
      }
    ]));

    // Build a summary message
    const summary = `You selected: ${selectedDresses.map(d => `"${d.name}"`).join(", ")}. Would you like to proceed with booking, or view more dresses?`;

    res.json({
      fulfillment_response: {
        messages: [
          {
            payload: { richContent: selectedDressCards }
          },
          {
            text: { text: [summary] }
          }
        ]
      }
    });

  } catch (error) {
    console.error("SelectDress Webhook error:", error);
    res.json({
      fulfillment_response: {
        messages: [{ text: { text: ["Sorry, something went wrong while selecting the dress(es)."] } }]
      }
    });
  }
});
exports.selectDressWebhook = functions.https.onRequest(selectApp);