const router = require("express").Router();

module.exports = (orderCollection) => {
  const paymentController = require("../controller/paymentController")(orderCollection);
  const middleware = require("../middleware/middleware");

  // Create payment
  router.post("/create", middleware.bkash_auth, paymentController.payment_create);

  // Payment callback
  router.get("/callback", middleware.bkash_auth, paymentController.call_back);

  return router;
};
