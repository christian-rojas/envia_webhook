const { createClient } = require("@supabase/supabase-js");
const dotenv = require("dotenv");
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// Add this function to save shipment data
async function saveShipmentData(order, shipmentResponse, enviaData) {
  try {
    // Start a transaction using supabase
    const { data: shipment, error: shipmentError } = await supabase
      .from("shipments")
      .insert({
        shopify_order_id: shipmentResponse.packages[0].content,
        order_number: order.order_number,
        tracking_number: enviaData.tracking_number || null,
        status: enviaData.error ? "error" : "generated",
      })
      .select()
      .single();

    if (shipmentError) throw shipmentError;

    // Insert shipping address
    const { error: addressError } = await supabase.from("shipping_addresses").insert({
      shipment_id: shipment.id,
      name: `${order.shipping_address.first_name} ${order.shipping_address.last_name}`,
      email: order.email,
      phone: order.shipping_address.phone,
      street: order.shipping_address.address1,
      number: order.shipping_address.number || "000001",
      city: order.shipping_address.city,
      state: order.shipping_address.province_code,
      country: order.shipping_address.country_code,
      postal_code: order.shipping_address.zip,
    });

    if (addressError) throw addressError;

    // Insert package information
    const { error: packageError } = await supabase.from("packages").insert({
      shipment_id: shipment.id,
      content: shipmentResponse.packages[0].content,
      amount: shipmentResponse.packages[0].amount,
      type: shipmentResponse.packages[0].type,
      weight: shipmentResponse.packages[0].weight,
      weight_unit: "KG",
      length: shipmentResponse.packages[0].dimensions.length,
      width: shipmentResponse.packages[0].dimensions.width,
      height: shipmentResponse.packages[0].dimensions.height,
      length_unit: "CM",
      declared_value: shipmentResponse.packages[0].declaredValue,
    });

    if (packageError) throw packageError;

    // Log the API response
    const { error: logError } = await supabase.from("shipment_logs").insert({
      shipment_id: shipment.id,
      api_response: enviaData,
      error_message: enviaData.error?.message || null,
      current_balance: enviaData.data?.[0]?.currentBalance || null,
    });

    if (logError) throw logError;

    return shipment;
  } catch (error) {
    console.error("Error saving to Supabase:", error);
    throw error;
  }
}

module.exports = {
  saveShipmentData,
};
