// server.js
const express = require('express');
const crypto = require('crypto');
const app = express();

app.use(express.json());

// ========================================
// YOUR TIMETAP CREDENTIALS
// ========================================
const BUSINESS_ID = '403923';
const API_PRIVATE_KEY = '03c87c55bb7f43b0ad77e5bed7f732da';
const STAFF_ID = 512602;
const LOCATION_ID = 634895;
const REASON_ID = 733663;

// ========================================
// HELPER: GET TIMETAP SESSION TOKEN
// ========================================
async function getTimeTapSession() {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash('md5')
    .update(BUSINESS_ID + API_PRIVATE_KEY)
    .digest('hex');

  const sessionUrl = `https://api.timetap.com/live/sessionToken?apiKey=${BUSINESS_ID}&timestamp=${timestamp}&signature=${signature}`;

  const response = await fetch(sessionUrl);
  const data = await response.json();
  return data.sessionToken;
}

// ========================================
// HELPER: FORMAT TIME
// ========================================
function formatTime(militaryTime) {
  const hour = Math.floor(militaryTime / 100);
  const minute = militaryTime % 100;
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
  const displayMinute = minute.toString().padStart(2, '0');
  return `${displayHour}:${displayMinute} ${period}`;
}

// ========================================
// HELPER: CONVERT TO MILITARY TIME
// ========================================
function toMilitaryTime(timeString) {
  if (!timeString) return 900;
  
  const cleanTime = timeString.trim().toUpperCase();
  
  if (/^\d{3,4}$/.test(cleanTime.replace(':', ''))) {
    return parseInt(cleanTime.replace(':', ''));
  }
  
  const match = cleanTime.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?/);
  if (!match) return 900;
  
  let hour = parseInt(match[1]);
  const minute = parseInt(match[2] || '0');
  const period = match[3];
  
  if (period === 'PM' && hour !== 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  
  return hour * 100 + minute;
}

// ========================================
// ENDPOINT 1: CHECK AVAILABILITY
// ========================================
app.post('/check-availability', async (req, res) => {
  try {
    const { requested_appointment_date } = req.body;

    // Parse date
    let year, month, day;
    if (requested_appointment_date && requested_appointment_date.includes('-')) {
      const parts = requested_appointment_date.split('-');
      year = parts[0];
      month = parts[1];
      day = parts[2];
    } else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      year = tomorrow.getFullYear().toString();
      month = (tomorrow.getMonth() + 1).toString().padStart(2, '0');
      day = tomorrow.getDate().toString().padStart(2, '0');
    }

    // Get session token
    const sessionToken = await getTimeTapSession();

    // Get available slots
    const availabilityUrl = `https://api.timetap.com/live/availability/${year}/${month}/${day}/${STAFF_ID}/${LOCATION_ID}/${REASON_ID}`;
    
    const availResponse = await fetch(availabilityUrl, {
      headers: {
        'Authorization': `Bearer ${sessionToken}`,
        'Content-Type': 'application/json'
      }
    });

    const availableSlots = await availResponse.json();

    // Format response
    if (!Array.isArray(availableSlots) || availableSlots.length === 0) {
      return res.json({
        available_times: "no available times",
        success: false,
        requested_date: `${year}-${month}-${day}`
      });
    }

    const timesList = availableSlots.map(slot => formatTime(slot.clientStartTime));
    const timesString = timesList.join(', ');

    res.json({
      available_times: timesString,
      available_slots_json: JSON.stringify(availableSlots),
      requested_date: `${year}-${month}-${day}`,
      staff_id: STAFF_ID,
      location_id: LOCATION_ID,
      reason_id: REASON_ID,
      success: true
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ========================================
// ENDPOINT 2: BOOK APPOINTMENT
// ========================================
app.post('/book-appointment', async (req, res) => {
  try {
    const {
      customer_first_name,
      customer_last_name,
      customer_phone,
      property_address,
      zip_code,
      requested_appointment_date,
      confirmed_appointment_time,
      project_type
    } = req.body;

    // Convert time
    const militaryTime = toMilitaryTime(confirmed_appointment_time);
    const endTime = militaryTime + 100;

    // Get session token
    const sessionToken = await getTimeTapSession();

    // Build appointment payload
    const appointmentPayload = {
      businessId: parseInt(BUSINESS_ID),
      client: {
        firstName: customer_first_name || "Unknown",
        lastName: customer_last_name || "Customer",
        cellPhone: customer_phone || "",
        address: property_address || "",
        zip: zip_code || ""
      },
      clientStartDate: requested_appointment_date,
      clientEndDate: requested_appointment_date,
      clientStartTime: militaryTime,
      clientEndTime: endTime,
      startDate: requested_appointment_date,
      endDate: requested_appointment_date,
      startTime: militaryTime,
      endTime: endTime,
      location: { locationId: LOCATION_ID },
      staff: { professionalId: STAFF_ID },
      reason: { reasonId: REASON_ID },
      clientReminderHours: 24,
      staffReminderHours: 24,
      remindClientSmsHrs: 2,
      remindStaffSmsHrs: 0,
      sendConfirmationToClient: true,
      sendConfirmationToStaff: true,
      status: "OPEN",
      note: `Project Type: ${project_type || 'Not specified'}. Address: ${property_address || 'Not specified'}.`
    };

    // Book appointment
    const bookingUrl = 'https://api.timetap.com/live/appointments';
    const bookingResponse = await fetch(bookingUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessionToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(appointmentPayload)
    });

    const bookingResult = await bookingResponse.json();

    if (bookingResponse.ok) {
      res.json({
        success: true,
        appointment_id: bookingResult.calendarId || 'Unknown',
        confirmation_number: bookingResult.appointmentIdHash || 'Unknown',
        appointment_date: requested_appointment_date,
        appointment_time: confirmed_appointment_time,
        customer_name: `${customer_first_name} ${customer_last_name}`,
        status_message: 'Appointment booked successfully!'
      });
    } else {
      res.status(400).json({
        success: false,
        error: JSON.stringify(bookingResult),
        status_message: 'Booking failed'
      });
    }

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      status_message: 'Booking failed with exception'
    });
  }
});

// ========================================
// HEALTH CHECK
// ========================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'TimeTap Bridge Server Running' });
});

// ========================================
// START SERVER
// ========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 TimeTap Bridge Server running on port ${PORT}`);
  console.log(`📍 Endpoints:`);
  console.log(`   - POST /check-availability`);
  console.log(`   - POST /book-appointment`);
  console.log(`   - GET /health`);
});