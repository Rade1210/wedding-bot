const functions = require("firebase-functions");
const express = require("express");
const admin = require("firebase-admin");
const bodyParser = require("body-parser");

// Firebase Admin initialization
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// ------------ FIND DRESS WEBHOOK (with hasDresses flag) ------------
const findApp = express();
findApp.use(bodyParser.json());

findApp.post("/", async (req, res) => {
  try {
    const params = req.body.sessionInfo?.parameters || {};
    
    console.log("FIND_DRESS FULL REQUEST BODY:", JSON.stringify(req.body, null, 2));
    console.log("FIND_DRESS PARAMS:", JSON.stringify(params, null, 2));

    // Safely extract parameters with defaults
    const dressType = params.dress_type || params.dressType || "";
    const dressSize = Number(params.dress_size || params.dressSize || 0);
    const minPrice = Number(params.dress_min_price || params.dressMinPrice || 0);
    const maxPrice = Number(params.dress_max_price || params.dressMaxPrice || 10000);

    console.log("Extracted parameters:");
    console.log("- Type:", dressType);
    console.log("- Size:", dressSize);
    console.log("- Min Price:", minPrice);
    console.log("- Max Price:", maxPrice);

    // Validate required parameters
    if (!dressType || !dressSize) {
      return res.json({
        fulfillment_response: {
          messages: [
            { text: { text: ["Missing dress type or size. Please provide all search criteria."] } }
          ]
        }
      });
    }

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

    // Set simple boolean flag
    const hasDresses = matchingDresses.length > 0;

    let messages;
    if (!hasDresses) {
      messages = [{ text: { text: ["I couldn't find any dresses matching your criteria. You will be returned to the main menu."] } }];
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
      sessionInfo: { 
        parameters: { 
          ...params, 
          matchingDresses,
          hasDresses: hasDresses  // Simple true/false flag
        } 
      },
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

// ------------ SELECT DRESS WEBHOOK (chips removed for UI) ------------
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

    // Summary message
    const summary = `You selected: ${selectedDresses.map(d => `"${d.name}"`).join(", ")}. What would you like to do next?`;

    // Only include dress cards and summary - NO CHIPS
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
      sessionInfo: {
        parameters: {
          ...params,
          selectedDresses: selectedDresses,
          matchingDresses: matchingDresses,
          suggestedAction: "dress_selection_complete"
        }
      },
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

// ------------ SAVE BOOKING TO FIRESTORE WEBHOOK ------------
const saveBookingApp = express();
saveBookingApp.use(bodyParser.json());

saveBookingApp.post("/", async (req, res) => {
  try {
    const params = req.body.sessionInfo.parameters;
    const sessionInfo = req.body.sessionInfo;
    
    console.log("SAVE_BOOKING INPUT PARAMS:", JSON.stringify(params, null, 2));

    // Handle both camelCase and lowercase parameter names
    const customerName = params.customerName || params.customername;
    const customerEmail = params.customerEmail || params.customeremail;
    const customerPhone = params.customerPhone || params.customerphone;
    const selectedDate = params.selectedDate || params.selecteddate;
    const selectedTime = params.selectedTime || params.selectedtime;
    const selectedDresses = params.selectedDresses || params.selecteddresses || [];

    // Validate required fields
    const missing = [];
    if (!customerName) missing.push("name");
    if (!customerEmail) missing.push("email");
    if (!selectedDate) missing.push("date");
    if (!selectedTime) missing.push("time");
    if (!selectedDresses || selectedDresses.length === 0) missing.push("dress selection");

    if (missing.length > 0) {
      return res.json({
        fulfillment_response: {
          messages: [
            { text: { text: [`Missing required information: ${missing.join(", ")}. Please provide all details.`] } }
          ]
        }
      });
    }

    // Format the date from object to string
    let formattedDate;
    if (typeof selectedDate === 'object') {
      // Date comes as {year: 2025, month: 11, day: 8}
      formattedDate = new Date(selectedDate.year, selectedDate.month - 1, selectedDate.day);
    } else {
      formattedDate = new Date(selectedDate);
    }

    // Format the time from object to string
    let formattedTime;
    if (typeof selectedTime === 'object') {
      // Time comes as {hours: 10, minutes: 0, seconds: 0, nanos: 0}
      const period = selectedTime.hours >= 12 ? 'PM' : 'AM';
      const hours12 = selectedTime.hours % 12 || 12;
      formattedTime = `${hours12}:${selectedTime.minutes.toString().padStart(2, '0')} ${period}`;
    } else {
      formattedTime = selectedTime;
    }

    // Calculate total price
    const totalPrice = selectedDresses.reduce((total, dress) => total + dress.price, 0);

    // Prepare booking data
    const bookingData = {
      customerInfo: {
        name: customerName,
        email: customerEmail,
        phone: customerPhone || "Not provided"
      },
      appointmentDetails: {
        date: admin.firestore.Timestamp.fromDate(formattedDate),
        time: formattedTime,
        duration: 60
      },
      dressSelection: selectedDresses.map(dress => ({
        dressId: dress.name.replace(/\s+/g, '_').toLowerCase(),
        name: dress.name,
        price: dress.price,
        imageUrl: dress.image_url,
        size: params.dress_size || 8
      })),
      metadata: {
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        sessionId: sessionInfo.session || "unknown"
      },
      bookingStatus: "confirmed",
      totalPrice: totalPrice
    };

    // Save to Firestore
    const bookingRef = await db.collection("bookings").add(bookingData);
    
    console.log("Booking saved with ID:", bookingRef.id);

    // Send confirmation message
    const confirmationMessage = [
      {
        type: "description",
        title: "✅ Booking Confirmed!",
        text: [
          `Thank you ${customerName}!`,
          `Your dress fitting appointment has been scheduled.`,
          `**Date:** ${formattedDate.toLocaleDateString()}`,
          `**Time:** ${formattedTime}`
        ]
      }
    ];

    res.json({
      sessionInfo: {
        parameters: {
          ...params,
          bookingId: bookingRef.id,
          bookingCompleted: true
        }
      },
      fulfillment_response: {
        messages: [
          { payload: { richContent: [confirmationMessage] } }
        ]
      }
    });

  } catch (error) {
    console.error("SaveBooking Webhook error:", error);
    res.json({
      fulfillment_response: {
        messages: [
          { text: { text: ["Sorry, something went wrong while saving your booking. Please try again."] } }
        ]
      }
    });
  }
});
exports.saveBookingWebhook = functions.https.onRequest(saveBookingApp);

// ------------ DEBUG WEBHOOK ------------
const debugApp = express();
debugApp.use(bodyParser.json());

debugApp.post("/", async (req, res) => {
  try {
    const params = req.body.sessionInfo.parameters;
    const sessionInfo = req.body.sessionInfo;
    
    console.log("DEBUG - ALL PARAMETERS:", JSON.stringify(params, null, 2));
    console.log("DEBUG - SESSION INFO:", sessionInfo.session);

    const debugMessage = [
      {
        type: "description",
        title: "🔍 Debug Info",
        text: [
          `customerName: ${params.customerName || params.customername || "MISSING"}`,
          `customerEmail: ${params.customerEmail || params.customeremail || "MISSING"}`,
          `customerPhone: ${params.customerPhone || params.customerphone || "MISSING"}`,
          `selectedDate: ${params.selectedDate || params.selecteddate || "MISSING"}`,
          `selectedTime: ${params.selectedTime || params.selectedtime || "MISSING"}`,
          `selectedDresses: ${(params.selectedDresses || params.selecteddresses) ? "EXISTS" : "MISSING"}`,
          `selectedDresses count: ${(params.selectedDresses || params.selecteddresses) ? (params.selectedDresses || params.selecteddresses).length : 0}`
        ]
      }
    ];

    res.json({
      fulfillment_response: {
        messages: [
          { payload: { richContent: [debugMessage] } }
        ]
      }
    });

  } catch (error) {
    console.error("Debug Webhook error:", error);
    res.json({
      fulfillment_response: {
        messages: [{ text: { text: ["Debug error occurred"] } }]
      }
    });
  }
});
exports.debugWebhook = functions.https.onRequest(debugApp);