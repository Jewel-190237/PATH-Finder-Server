const axios = require("axios");
const { getValue } = require("node-global-storage");
const { ObjectId } = require("mongodb");

class PaymentController {
  constructor(orderCollections) {
    this.orderCollections = orderCollections;
  }

  bkash_headers = async () => {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      authorization: getValue("id_token"),
      "x-app-key": process.env.bkash_api_key,
    };
  };

  payment_create = async (req, res) => {
    const { amount, userId, courseId } = req.body;
    try {
      const order = await this.orderCollections.insertOne({
        userId,
        amount,
        courseId,
        status: "pending",
        createdAt: new Date(),
      });
      const { data } = await axios.post(
        process.env.bkash_create_payment_url,
        {
          mode: "0011",
          payerReference: " ",
          callbackURL: "http://localhost:5000/api/bkash/payment/callback",
          amount,
          currency: "BDT",
          intent: "sale",
          merchantInvoiceNumber: order.insertedId.toString(),
        },
        {
          headers: await this.bkash_headers(),
        }
      );

      res.status(200).json({ bkashURL: data.bkashURL });
    } catch (error) {
      console.error("Error creating payment:", error.message);
      res.status(500).json({ error: "Failed to create payment" });
    }
  };

  call_back = async (req, res) => {
    const { paymentID, status } = req.query;

    if (status === "cancel" || status === "failure") {
      return res.redirect(`http://localhost:5173/payment/fail?message=${status}`);
    }

    if (status === "success") {
      try {
        const { data } = await axios.post(
          process.env.bkash_execute_payment_url,
          { paymentID },
          {
            headers: await this.bkash_headers(),
          }
        );

        if (data && data.statusCode === "0000") {
          const result = await this.orderCollections.updateOne(
            { _id: new ObjectId(data.merchantInvoiceNumber) },
            {
              $set: {
                status: "paid",
                trxID: data.trxID,
                paymentID,
                paymentExecuteTime: data.paymentExecuteTime,
              },
            }
          );

          if (result.modifiedCount === 1) {
            return res.redirect(`http://localhost:5173/payment/success`);
          } else {
            return res.redirect(
              `http://localhost:5173/payment/fail?message=Order not found`
            );
          }
        } else {
          return res.redirect(
            `http://localhost:5173/payment/fail?message=${data.statusMessage}`
          );
        }
      } catch (error) {
        console.error("Error executing payment:", error.message);
        return res.redirect(
          `http://localhost:5173/payment/fail?message=${error.message}`
        );
      }
    }
  };
}

module.exports = (orderCollections) => new PaymentController(orderCollections);
