const functions = require("firebase-functions");
const express = require("express");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");

// Firebase Admin initialization
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// ------------ FIND DRESS WEBHOOK ------------
const findApp = express();
findApp.use(bodyParser.json());

findApp.post("/", async (req, res) => {
  try {
    const params = req.body.sessionInfo.parameters;
    const dressType = params.dress_type;
    const dressSize = Number(params.dress_size);
    const minPrice = Number(params.dress_min_price);
    const maxPrice = Number(params.dress_max_price);

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
      messages = [{ text: { text: ["I couldn't find any dresses matching your criteria. Would you like to adjust your search?"] } }];
    } else {
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
                name: "select-dress",
                languageCode: "",
                parameters: { selectedNumber: idx + 1 }
              }
            }
          ]
        }
      ]);
      messages = [{ payload: { richContent } }];
    }

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

// ------------ SELECT DRESS WEBHOOK (MULTI + CHIPS, Messenger friendly) ------------
const selectApp = express();
selectApp.use(bodyParser.json());

selectApp.post("/", async (req, res) => {
  try {
    const params = req.body.sessionInfo.parameters;
    console.log("SELECT_DRESS INPUT PARAMS:", JSON.stringify(params, null, 2));

    // Get numbers (array): supports any incoming case
    let selectedNumbers = params.selectedNumbers || params.selectednumbers || params.selectedNumber || params.selectednumber;
    if (!Array.isArray(selectedNumbers)) selectedNumbers = [selectedNumbers];
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

    // Select valid dresses
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

    // Each dress as a card (array of image+info)
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

    // Summary message with chips included in the same message
    const summary = `You selected: ${selectedDresses.map(d => `"${d.name}"`).join(", ")}. What would you like to do next?`;

    // Combine all cards, summary, and chips into one richContent array
    const richContentAll = [
      ...selectedDressCards,
      [
        {
          type: "description",
          title: "Selection Summary",
          text: [summary]
        }
      ]
    ];

    res.json({
      fulfillment_response: {
        messages: [
          { payload: { richContent: richContentAll } }
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