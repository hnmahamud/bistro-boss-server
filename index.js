const express = require("express");
var cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SK_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access" });
  }
  const token = authorization.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res
        .status(401)
        .send({ error: true, message: "unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.6jia9zl.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    client.connect();

    const database = client.db("bistroDB");
    const menuCollection = database.collection("menu");
    const reviewsCollection = database.collection("reviews");
    const cartCollection = database.collection("carts");
    const userCollection = database.collection("users");
    const paymentCollection = database.collection("payments");

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      if (user?.role !== "admin") {
        return res
          .status(403)
          .send({ error: true, message: "forbidden access" });
      }
      next();
    };

    // Create jwt token
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // Get all menu
    app.get("/menu", async (req, res) => {
      const cursor = menuCollection.find({});
      const result = await cursor.toArray();
      res.send(result);
    });

    // Create menu
    app.post("/menu", verifyJWT, verifyAdmin, async (req, res) => {
      const newItem = req.body;
      const result = await menuCollection.insertOne(newItem);

      if (result.insertedId) {
        console.log("Item added successfully!");
      } else {
        console.log("Item added failed!");
      }
      res.send(result);
    });

    // delete menu
    app.delete("/menu/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const itemId = req.params.id;
      const query = { _id: new ObjectId(itemId) };
      const result = await menuCollection.deleteOne(query);
      if (result.deletedCount === 1) {
        console.log("Successfully deleted one document.");
      } else {
        console.log("No documents matched the query. Deleted 0 documents.");
      }
      res.send(result);
    });

    // Get all reviews
    app.get("/reviews", async (req, res) => {
      const cursor = reviewsCollection.find({});
      const result = await cursor.toArray();
      res.send(result);
    });

    // Get all users
    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const cursor = userCollection.find({});
      const result = await cursor.toArray();
      res.send(result);
    });

    // Create user
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const isExist = await userCollection.findOne(query);

      if (isExist) {
        return res.send({ message: "User already exist!" });
      }

      const doc = {
        ...user,
      };

      const result = await userCollection.insertOne(doc);
      if (result.insertedId) {
        console.log("User added successfully!");
      } else {
        console.log("User added failed!");
      }
      res.send(result);
    });

    // Check user admin or not
    app.get("/users/admin/:email", verifyJWT, async (req, res) => {
      const email = req.params.email;

      if (req.decoded.email !== email) {
        return res.send({ admin: false });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      const result = { admin: user?.role === "admin" };
      res.send(result);
    });

    // Make admin
    app.patch("/users/admin/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: "admin",
        },
      };
      const result = await userCollection.updateOne(filter, updateDoc);
      if (result.modifiedCount > 0) {
        console.log("Role updated successfully!");
      } else {
        console.log("Role updated failed!");
      }
      res.send(result);
    });

    // Get all items from cart
    app.get("/carts", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const query = { userEmail: email };
      const cursor = cartCollection.find(query);
      const result = await cursor.toArray();
      if (!email) {
        return res.send([]);
      }

      const decodedEmail = req.decoded.email;
      if (decodedEmail !== email) {
        return res
          .status(403)
          .send({ error: true, message: "forbidden access" });
      }

      res.send(result);
    });

    // Add to cart
    app.post("/carts", async (req, res) => {
      const item = req.body;
      const doc = {
        ...item,
      };
      const result = await cartCollection.insertOne(doc);
      if (result.insertedId) {
        console.log("Add to cart successfully!");
      } else {
        console.log("Add to card failed!");
      }
      res.send(result);
    });

    // Delete cart item
    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);

      if (result.deletedCount === 1) {
        console.log("Successfully deleted one document.");
      } else {
        console.log("No documents matched the query. Deleted 0 documents.");
      }
      res.send(result);
    });

    // Stripe payment intent
    app.post("/create-payment-intent", verifyJWT, async (req, res) => {
      const { price } = req.body;
      const amount = price * 100;

      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const insertResult = await paymentCollection.insertOne(payment);

      const cartItemIds = payment.cartItems.map((id) => new ObjectId(id));

      const query = { _id: { $in: cartItemIds } };
      const deleteResult = await cartCollection.deleteMany(query);

      res.send({ insertResult, deleteResult });
    });

    app.get("/admin-stats", verifyJWT, verifyAdmin, async (req, res) => {
      const customers = await userCollection.estimatedDocumentCount();
      const products = await menuCollection.estimatedDocumentCount();
      const orders = await paymentCollection.estimatedDocumentCount();

      // Using array reduce
      // const allOrders = await paymentCollection.find().toArray();
      // const initialValue = 0;
      // const revenue = allOrders.reduce(
      //   (accumulator, currentValue) => accumulator + currentValue.price,
      //   initialValue
      // );

      // Using mongodb query
      const total = await paymentCollection
        .aggregate([{ $group: { _id: null, totalPrice: { $sum: "$price" } } }])
        .toArray();
      const revenue = total.length > 0 ? total[0].totalPrice : 0;

      res.send({
        customers,
        products,
        orders,
        revenue,
      });
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running...");
});

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});
