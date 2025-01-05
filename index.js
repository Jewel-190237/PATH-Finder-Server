const express = require("express");
const app = express();
const SSLCommerzPayment = require("sslcommerz-lts");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const cors = require("cors");
const jwt = require("jsonwebtoken");
const PORT = process.env.PORT || 5000;
const nodemailer = require("nodemailer");
const e = require("express");

// MiddleWare
app.use(cors());
app.use(express.json());

// JWT Authentication Middleware
const verifyJWT = (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  const tokenWithoutBearer = token.split(" ")[1];

  jwt.verify(tokenWithoutBearer, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    }
    req.user = decoded;
    next();
  });
};

// Admin Role Middleware
const verifyAdmin = async (req, res, next) => {
  try {
    const user = await client
      .db("PATH-FINDER")
      .collection("users")
      .findOne({ _id: new ObjectId(req.user.id) });
    if (user && user.role === "admin") {
      next();
    } else {
      res.status(403).send({ message: "Admin access required" });
    }
  } catch (error) {
    res.status(500).send({ message: "Error verifying admin role", error });
  }
};

// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.kwtddbl.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.kwtddbl.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

//ssl SSLCommerzPayment
const store_id = process.env.STORE_ID;
const store_passwd = process.env.STORE_PASS;
const is_live = false;

async function run() {
  try {
    const userCollections = client.db("PATH-FINDER").collection("users");
    const orderCollections = client.db("Bus-Ticket").collection("orders");
    const allocatedSeatCollections = client
      .db("Bus-Ticket")
      .collection("allocatedSeat");
    const busCollections = client.db("Bus-Ticket").collection("buses");
    const routeCollections = client.db("Bus-Ticket").collection("routes");

    // Create user (sign-up)
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { phone: user.phone };
      const existingUser = await userCollections.findOne(query);

      if (existingUser) {
        return res
          .status(409)
          .send({ message: "User already exists. Please login." });
      }
      if (user.role === "subAdmin") {
        user.status = "pending";
      }

      if (user.role === "student") {
        if (user.code == 123465) {
          user.subAdmin = "CEO";
        } else if (user.code == 123456) {
          user.subAdmin = "Marketing Panel";
        } else if (user.code == 134456) {
          user.subAdmin = "Marketing Executive";
        } else if (user.code == 126756) {
          user.subAdmin = "Skill Strategist";
        } else if (user.code == 128656) {
          user.subAdmin = "Skill Specialist";
        } else if (user.code == 123956) {
          user.subAdmin = "Dev Advisor";
        } else if (user.code == 123466) {
          user.subAdmin = "Sales Director";
        } else if (user.code == 123467) {
          user.subAdmin = "Virtual assistant";
        } else {
          user.subAdmin = "";
        }
      }
      
      const result = await userCollections.insertOne(user);
      res.status(200).send(result);
    });

    // Route to approve user status
    app.put("/users/:id/approve", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const role = req.body.role;
      const query = { _id: new ObjectId(id) };

      const update = role
        ? { $set: { subRole: role } }
        : { $set: { status: "approved" } };

      try {
        const result = await userCollections.updateOne(query, update);

        if (result.modifiedCount === 1) {
          res.status(200).send({
            success: true,
            message: role
              ? "Sub-role updated successfully"
              : "User approved successfully",
          });
        } else {
          res.status(404).send({
            success: false,
            message: "User not found or no changes made",
          });
        }
      } catch (error) {
        res.status(500).send({
          success: false,
          message: "Error updating user",
          error,
        });
      }
    });

    // Login
    app.post("/login", async (req, res) => {
      const { phone, password, role } = req.body;

      try {
        // Find the user by phone number
        const user = await userCollections.findOne({ phone });
        if (!user) {
          return res.status(402).send({ message: "User not found" });
        }

        if (user.role !== role) {
          return res
            .status(403)
            .send({ message: "Access denied. Role does not match." });
        }

        // Check if the password matches
        if (password !== user.password) {
          return res.status(401).send({ message: "Invalid password" });
        }

        const token = jwt.sign(
          { id: user._id, role: user.role },
          process.env.JWT_SECRET,
          { expiresIn: "15d" }
        );
        userToken = token;
        res.status(200).send({
          message: "Login successful",
          token,
          userId: user._id,
          role: user.role,
          subRole: user.subRole,
        });
      } catch (error) {
        res.status(500).send({ message: "Login failed", error });
      }
    });

    // add task to specific user
    app.post("/add-task", verifyJWT, async (req, res) => {
      const { userId, taskName, taskDescription } = req.body;

      if (!userId || !taskName || !taskDescription) {
        return res.status(400).json({ message: "Missing required fields" });
      }

      try {
        const user = await userCollections.findOne({
          _id: new ObjectId(userId),
        });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        // Update the user's tasks array
        const updatedTasks = user.tasks || [];
        updatedTasks.push({ taskName, taskDescription });

        const result = await userCollections.updateOne(
          { _id: new ObjectId(userId) },
          { $set: { tasks: updatedTasks } },
          { $set: { taskStatus: "pending" } }
        );

        if (result.modifiedCount === 1) {
          res
            .status(200)
            .json({ message: "Task added successfully", tasks: updatedTasks });
        } else {
          res.status(500).json({ message: "Failed to add task" });
        }
      } catch (error) {
        console.error("Error adding task:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // Check user authentication status
    app.get("/auth-status", verifyJWT, async (req, res) => {
      res.status(200).send({ isLoggedIn: true, role: req.user.role });
    });

    // get user role for discount option
    app.get("/user-role/:userId", verifyJWT, async (req, res) => {
      try {
        const userId = req.params.userId;

        if (!userId) {
          return res.status(400).send({
            isLoggedIn: false,
            role: null,
            message: "User ID is required",
          });
        }

        const user = await userCollections.findOne({
          _id: new ObjectId(userId),
        });

        if (user) {
          const role = user.role;

          if (role === "subAdmin") {
            if (user.status === "approved") {
              return res
                .status(200)
                .send({ isLoggedIn: true, role: "subAdmin" });
            } else {
              return res.status(200).send({
                isLoggedIn: true,
                role: null,
                message: "Master status not approved",
              });
            }
          }

          if (role === "admin") {
            return res.status(200).send({ isLoggedIn: true, role: "admin" });
          }

          return res.status(200).send({ isLoggedIn: true, role: role });
        } else {
          return res
            .status(404)
            .send({ isLoggedIn: false, role: null, message: "User not found" });
        }
      } catch (error) {
        console.error("Error fetching user role:", error);
        return res.status(500).send({
          isLoggedIn: false,
          role: null,
          error: "Internal Server Error",
        });
      }
    });

    // get user and role and subRole for Dashboard access
    app.get("/get-user-role/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const user = await userCollections.findOne({ _id: new ObjectId(id) });
        if (user) {
          const { _id, name, phone, role, subRole, status, tasks } = user;
          res
            .status(200)
            .send({ _id, name, phone, role, subRole, status, tasks });
        } else {
          res.status(404).send({ message: "User not found" });
        }
      } catch (error) {
        res.status(500).send({ message: "Error fetching user", error });
      }
    });

    // Get all users (admin-only access)
    app.get("/users", verifyJWT, async (req, res) => {
      try {
        const user = userCollections.find();
        const result = await user.toArray();
        res.status(200).send(result);
      } catch (error) {
        res.status(500).send({ message: "Error fetching users", error });
      }
    });

    // Delete a specific user (admin-only access)
    app.delete("/users/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      try {
        const result = await userCollections.deleteOne(query);
        if (result.deletedCount === 1) {
          res.status(200).send({ message: "User deleted successfully" });
        } else {
          res.status(404).send({ message: "User not found" });
        }
      } catch (error) {
        res.status(500).send({ message: "Error deleting user", error });
      }
    });

    // email verification
    app.post("/forgetPassword", async (req, res) => {
      const { phone, email } = req.body;

      try {
        const existingUser = await userCollections.findOne({ phone });

        if (!existingUser) {
          return res.status(404).send({ message: "User not found" });
        }

        //sent email
        var transporter = nodemailer.createTransport({
          service: "gmail",
          auth: {
            user: "190237@ku.ac.bd",
            pass: "afio mvyu nrrc urkv",
          },
        });
        const token = jwt.sign(
          { id: existingUser._id, role: existingUser.role },
          process.env.JWT_SECRET,
          { expiresIn: "5m" }
        );
        var mailOptions = {
          from: "190237@ku.ac.bd",
          to: email,
          subject: "Reset Password",
          text: `http://localhost:5173/resetPassword/${token}`,
        };

        transporter.sendMail(mailOptions, function (error, info) {
          if (error) {
            console.log(error);
          } else {
            console.log("Email sent: " + info.response);
          }
        });

        res.status(200).send({ message: "User found", email: email });
      } catch (error) {
        res
          .status(500)
          .send({ message: "Error while searching for user", error });
      }
    });

    // reset password
    app.post("/resetPassword", async (req, res) => {
      const { token, newPassword } = req.body;

      try {
        jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
          if (err) {
            return res
              .status(400)
              .send({ message: "Invalid or expired token" });
          }

          const user = await userCollections.findOne({
            _id: new ObjectId(decoded.id),
          });

          if (!user) {
            return res.status(404).send({ message: "User not found" });
          }

          const result = await userCollections.updateOne(
            { _id: new ObjectId(user._id) },
            { $set: { password: newPassword } }
          );

          if (result.modifiedCount === 1) {
            return res
              .status(200)
              .send({ message: "Password updated successfully" });
          } else {
            return res
              .status(500)
              .send({ message: "Failed to update password" });
          }
        });
      } catch (error) {
        res
          .status(500)
          .send({ message: "Error while resetting password", error });
      }
    });

    // Offline Payment
    app.post("/paymentoffline", async (req, res) => {
      const {
        price,
        name,
        email,
        location,
        address,
        phone,
        allocatedSeat,
        busName,
        counterMaster,
        selectedRoute,
        date,
      } = req.body;
      const tran_id = new ObjectId().toString();

      const order = {
        price,
        name,
        phone,
        email,
        location,
        address,
        allocatedSeat,
        tran_id,
        status: "offline",
        busName,
        counterMaster,
        selectedRoute,
        date,
      };

      try {
        const result = await orderCollections.insertOne(order);
        const blockedSeat = await allocatedSeatCollections.insertOne(order);

        if (result.insertedId) {
          res.json({
            redirectUrl: `http://localhost:5173/payment/success/${tran_id}`,
          });
        } else {
          res.status(500).json({ message: "Failed to create order" });
        }
      } catch (error) {
        console.error("Error inserting order:", error);
        res.status(500).json({ message: "Server error" });
      }
    });

    // Payment integration
    app.post("/payment", async (req, res) => {
      const price = req.body.price;
      const name = req.body.name;
      const email = req.body.email;
      const location = req.body.location;
      const address = req.body.address;
      const phone = req.body.phone;
      const allocatedSeat = req.body.allocatedSeat;
      const busName = req.body.busName;
      const counterMaster = req.body.counterMaster;
      const selectedRoute = req.body.selectedRoute;
      const date = req.body.date;

      const tran_id = new ObjectId().toString();
      const data = {
        total_amount: price,
        currency: "BDT",
        tran_id: tran_id,
        success_url: `http://localhost:5000/payment/success/${tran_id}`,
        fail_url: `http://localhost:5000/payment/fail/${tran_id}`,
        cancel_url: "http://localhost:3030/cancel",
        ipn_url: "http://localhost:3030/ipn",
        shipping_method: "Courier",
        product_name: "Computer.",
        product_category: "Electronic",
        product_profile: "general",
        cus_name: name,
        cus_email: email,
        cus_add1: address,
        cus_add2: "Dhaka",
        cus_city: "Dhaka",
        cus_state: "Dhaka",
        cus_postcode: "1000",
        cus_country: "Bangladesh",
        cus_phone: phone,
        cus_fax: "01711111111",
        ship_name: "Customer Name",
        ship_add1: "Dhaka",
        ship_add2: "Dhaka",
        ship_city: "Dhaka",
        ship_state: "Dhaka",
        ship_postcode: 1000,
        ship_country: "Bangladesh",
        location: location,
        allocatedSeat: allocatedSeat,
      };

      const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
      sslcz
        .init(data)
        .then((apiResponse) => {
          // console.log('API Response:', apiResponse); // Log full response for debugging
          if (apiResponse.GatewayPageURL) {
            // Redirect the user to payment gateway
            let GatewayPageURL = apiResponse.GatewayPageURL;
            res.send({ url: GatewayPageURL });

            const order = {
              price: price,
              name: name,
              phone: phone,
              email: email,
              location: location,
              address: address,
              allocatedSeat: allocatedSeat,
              tran_id: tran_id,
              status: "loading",
              busName: busName,
              counterMaster: counterMaster,
              selectedRoute: selectedRoute,
              date: date,
            };

            const result = orderCollections.insertOne(order);
            const blockedSeat = allocatedSeatCollections.insertOne(order);

            console.log("Redirecting to: ", GatewayPageURL);
          } else {
            res.status(400).send({
              error: "Failed to get GatewayPageURL",
              details: apiResponse,
            });
          }
        })
        .catch((error) => {
          console.error("SSLCommerz API Error:", error);
          res
            .status(500)
            .send({ error: "Payment initialization failed", details: error });
        });
    });

    // payment success
    app.post("/payment/success/:tran_id", async (req, res) => {
      const result = await orderCollections.updateOne(
        { tran_id: req.params.tran_id },
        {
          $set: { status: "paid" },
        }
      );
      const success = await allocatedSeatCollections.updateOne(
        { tran_id: req.params.tran_id },
        {
          $set: { status: "paid" },
        }
      );
      if (result.modifiedCount > 0) {
        res.redirect(
          `http://localhost:5173/payment/success/${req.params.tran_id}`
        );
      }
    });

    //payment fail
    app.post("/payment/fail/:tran_id", async (req, res) => {
      const result = await orderCollections.deleteOne({
        tran_id: req.params.tran_id,
      });

      const seat = await allocatedSeatCollections.deleteOne({
        tran_id: req.params.tran_id,
      });

      if (result.deletedCount > 0 && seat.deletedCount > 0) {
        res.redirect(
          `http://localhost:5173/payment/fail/${req.params.tran_id}`
        );
      } else {
        res
          .status(500)
          .send({ message: "Failed to delete order or seat data" });
      }
    });

    // Get allocated seats with status 'paid'
    app.get("/allocated-seats/:busName", async (req, res) => {
      const { busName } = req.params;
      const { selectedDate } = req.query; // Get the selected date from the query parameters

      try {
        const paidSeats = await orderCollections
          .find({
            status: { $in: ["paid", "offline"] }, // Corrected filter for status
            busName: busName,
            date: selectedDate, // Filter by date as well
          })
          .toArray();

        res.status(200).send(paidSeats);
      } catch (error) {
        console.error("Error fetching allocated seats:", error);
        res
          .status(500)
          .send({ message: "Error fetching allocated seats", error });
      }
    });

    // Get order details by transaction ID for invoice Download
    app.get("/order/:tran_id", async (req, res) => {
      const tran_id = req.params.tran_id;
      try {
        const order = await orderCollections.findOne({ tran_id });
        if (order) {
          res.status(200).send(order);
        } else {
          res.status(404).send({ message: "Order not found" });
        }
      } catch (error) {
        res
          .status(500)
          .send({ message: "Error fetching order details", error });
      }
    });

    //getting routes
    app.get("/routes", async (req, res) => {
      const user = routeCollections.find();
      const result = await user.toArray();
      res.send(result);
    });

    // Add bus
    app.post("/buses", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const bus = req.body;

        // Query to check if a bus with the same name and route already exists
        const query = { busName: bus.busName, route1: bus.route1 };
        const existingBus = await busCollections.findOne(query);

        // If the bus already exists, return a conflict status
        if (existingBus) {
          return res.status(409).send({
            message: "Bus already exists with the same name and route.",
          });
        }

        // If the bus doesn't exist, insert the new bus data
        const result = await busCollections.insertOne(bus);
        return res.status(200).send(result);
      } catch (error) {
        // Handle any errors that occur during the process
        console.error("Error inserting bus data:", error);
        return res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // Bus Service
    app.get("/buses", async (req, res) => {
      const bus = busCollections.find();
      const result = await bus.toArray();
      res.send(result);
    });

    app.get("/buses/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await busCollections.findOne(query);
      res.send(result);
    });

    // delete a specific user
    app.delete("/users/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollections.deleteOne(query);
      res.send(result);
    });

    // posting route
    app.post("/routes", verifyJWT, verifyAdmin, async (req, res) => {
      try {
        const { busName, routes } = req.body;

        if (!busName || !routes) {
          return res
            .status(400)
            .send({ message: "Bus name and routes are required." });
        }

        // Check if a bus with the same busName already exists
        const existingBus = await routeCollections.findOne({ busName });

        if (existingBus) {
          // If the bus exists, update the existing bus's routes by appending new routes
          const updatedRoutes = [...existingBus.routes, ...routes];

          const updateResult = await routeCollections.updateOne(
            { busName }, // Filter by busName
            { $set: { routes: updatedRoutes } } // Update the routes field
          );

          if (updateResult.matchedCount === 0) {
            throw new Error("Failed to update the bus routes");
          }

          return res
            .status(200)
            .send({ message: "Bus routes updated successfully", updateResult });
        } else {
          // If the bus doesn't exist, insert a new bus
          const newBus = { busName, routes };

          const insertResult = await routeCollections.insertOne(newBus);

          if (!insertResult.acknowledged) {
            throw new Error("Failed to insert new bus");
          }

          return res
            .status(201)
            .send({ message: "New bus added successfully", insertResult });
        }
      } catch (error) {
        console.error("Error inserting/updating bus data:", error);
        return res
          .status(500)
          .send({ message: "Internal Server Error", error: error.message });
      }
    });

    // delete a specific routes
    app.delete(
      "/routes/:busId/:routeIndex",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const { busId, routeIndex } = req.params;

        // Find the bus by its ID
        const query = { _id: new ObjectId(busId) };
        const bus = await routeCollections.findOne(query);

        if (!bus) {
          return res.status(404).send({ message: "Bus not found" });
        }

        // Remove the specific route using the index
        const updatedRoutes = bus.routes.filter(
          (route, index) => index != routeIndex
        );

        // Update the bus with the modified routes
        const updateQuery = { _id: new ObjectId(busId) };
        const update = {
          $set: { routes: updatedRoutes },
        };

        const result = await routeCollections.updateOne(updateQuery, update);

        if (result.modifiedCount > 0) {
          res.send({ message: "Route deleted", deletedCount: 1 });
        } else {
          res.send({ message: "No route deleted", deletedCount: 0 });
        }
      }
    );

    // delete a specific user
    app.delete("/buses/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await busCollections.deleteOne(query);
      res.send(result);
    });

    // updated or put operation
    app.put("/buses/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updatedBus = req.body;
      const bus = {
        $set: {
          busName: updatedBus.busName,
          totalSeats: updatedBus.totalSeats,
          startTime: updatedBus.startTime,
          estimatedTime: updatedBus.estimatedTime,
        },
      };
      const result = await busCollections.updateOne(filter, bus, options);
      res.send(result);
    });

    // Updated user route
    app.put("/users/:userId", async (req, res) => {
      const { userId } = req.params;
      const { name, phone, location, role } = req.body;

      try {
        const filter = { _id: new ObjectId(userId) };
        const update = {
          $set: {
            name: name,
            phone: phone,
            location: location,
            role: role,
          },
        };

        const result = await userCollections.updateOne(filter, update);

        if (result.modifiedCount > 0) {
          res.send({ success: true, message: "User updated successfully." });
        } else {
          res.send({ success: false, message: "User not updated." });
        }
      } catch (error) {
        console.error("Error updating user:", error);
        res.status(500).send({
          success: false,
          message: "Something went wrong. Please try again.",
        });
      }
    });

    // updated routes
    app.put("/routes/:busId/:routeIndex", async (req, res) => {
      const { busId, routeIndex } = req.params;
      const { routeName, price } = req.body;

      try {
        const filter = { _id: new ObjectId(busId) };
        const update = {
          $set: {
            [`routes.${routeIndex}.routeName`]: routeName,
            [`routes.${routeIndex}.price`]: price,
          },
        };

        const result = await routeCollections.updateOne(filter, update);

        if (result.modifiedCount > 0) {
          res.send({ success: true, message: "Route updated successfully." });
        } else {
          res.send({ success: false, message: "Route not updated." });
        }
      } catch (error) {
        console.error("Error updating route:", error);
        res.status(500).send({
          success: false,
          message: "Something went wrong. Please try again.",
        });
      }
    });

    //get all order data
    app.get(
      "/order-seats/:busName",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const { busName } = req.params;
        const { selectedDate } = req.query; // Get the selected date from the query parameters

        try {
          const paidSeats = await orderCollections
            .find({
              status: "paid",
              busName: busName,
              date: selectedDate, // Filter by date as well
            })
            .toArray();

          res.status(200).send(paidSeats);
        } catch (error) {
          console.error("Error fetching allocated seats:", error);
          res
            .status(500)
            .send({ message: "Error fetching allocated seats", error });
        }
      }
    );

    // DELETE endpoint to delete a seat by bus name and seat ID
    app.delete(
      "/order-seats/:busName/:seatId",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const { busName, seatId } = req.params;

        try {
          const order = await orderCollections.findOne({
            _id: new ObjectId(seatId),
            busName: busName,
          });

          if (!order) {
            return res.status(404).send({ message: "Seat not found" });
          }

          const updatedOrder = await orderCollections.updateOne(
            { _id: new ObjectId(seatId), busName: busName },
            { $pull: { allocatedSeat: { $in: order.allocatedSeat } } }
          );

          if (updatedOrder.modifiedCount > 0) {
            // If all seats are removed, delete the entire order
            const remainingSeats = await orderCollections.findOne({
              _id: new ObjectId(seatId),
            });
            if (remainingSeats.allocatedSeat.length === 0) {
              await orderCollections.deleteOne({ _id: new ObjectId(seatId) });
            }

            res.status(200).send({ message: "Seat deleted successfully" });
          } else {
            res.status(500).send({ message: "Failed to delete seat" });
          }
        } catch (error) {
          console.error("Error deleting seat:", error);
          res.status(500).send({ message: "Error deleting seat", error });
        }
      }
    );

    app.get("/orders", async (req, res) => {
      const user = orderCollections.find();
      const result = await user.toArray();
      res.send(result);
    });

    // Route to clear all seats for a specific bus
    app.delete("/orders/clear-ala/:busName", async (req, res) => {
      const { busName } = req.params;
      console.log("Received busName:", busName);

      try {
        const result = await orderCollections.deleteMany({ busName: busName });

        if (result.deletedCount > 0) {
          res.status(200).send({
            message: `All allocated seats for bus ${busName} have been cleared.`,
          });
        } else {
          res
            .status(404)
            .send({ message: `No orders found for bus ${busName}.` });
        }
      } catch (error) {
        console.error("Error clearing allocated seats:", error.stack); // Log full error stack
        res
          .status(500)
          .send({ message: "Error clearing allocated seats", error });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("bus-ticket is running");
});

app.listen(PORT, () => {
  console.log(`bus-ticket is running on ${PORT}`);
});
