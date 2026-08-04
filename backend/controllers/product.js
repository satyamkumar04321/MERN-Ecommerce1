const Product = require('../models/product');
const User = require('../models/user');
const Review = require('../models/review');
const ApiFeatures = require('../utils/apifeatures');
const { Snowflake } = require('@theinternetfolks/snowflake');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const redisClient = require('../config/redisClient');
const dotenv = require('dotenv');
const { generateEmbedding } = require('../utils/generateEmbedding');

dotenv.config({ path: '../config/.env' });

const timestamp = Date.now();
const timestampInSeconds = Math.floor(timestamp / 1000);

// get all products
const getAllProducts = async (req, res, next) => {
    let products;

    const resultPerPage = process.env.RESULT_PER_PAGE || 8;
    const productsCount = await Product.countDocuments();

    const apiFeature = new ApiFeatures(Product.find(), req.query)
        .search()
        .filter();

    products = await apiFeature.query;

    let filteredProductsCount = products.length;

    apiFeature.pagination(resultPerPage);

    products = await apiFeature.query.clone();

    res.status(200).json({
        success: true,
        products,
        productsCount,
        resultPerPage,
        filteredProductsCount
    });
};

// Get All Products (Admin)
const getAdminProducts = async (req, res, next) => {
    const products = await Product.find();

    res.status(200).json({
        success: true,
        products
    });
};

// get product details
const getProductDetails = async (req, res, next) => {
    const productId = req.params.id;
    const cacheKey = `product:${productId}`;

    try {
        const cachedProduct = await redisClient.get(cacheKey);
        if (cachedProduct) {
            const productData = JSON.parse(cachedProduct);
            return res.status(200).json({
                success: true,
                product: productData
            });
        }

        const product = await Product.findById(productId);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        await redisClient.set(cacheKey, JSON.stringify(product), { EX: 3600 });

        res.status(200).json({
            success: true,
            product
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
};

const updateProduct = async (req, res, next) => {
    try {
        const productId = req.params.id;
        const product = await Product.findById(productId);

        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        if (req.body.name || req.body.description) {
            const textForEmbedding = `${req.body.name || product.name} ${req.body.description || product.description}`;
            const vector = await generateEmbedding(textForEmbedding);
            if (vector) {
                req.body.embedding = vector;
            }
        }

        const updatedProduct = await Product.findByIdAndUpdate(productId, req.body, {
            new: true,
            runValidators: true,
        });

        try {
            const cacheKey = `product:${productId}`;
            await redisClient.del(cacheKey);
            await redisClient.set(cacheKey, JSON.stringify(updatedProduct), { EX: 3600 });
        } catch (cacheError) {
            console.error('Redis cache sync error:', cacheError);
        }

        res.status(200).json({
            success: true,
            message: '✅ Product updated successfully.',
            product: updatedProduct,
        });
    } catch (error) {
        console.error('Product Update Error:', error);
        res.status(500).json({ message: 'Server Error during update' });
    }
};

// create new review or update the review
const createProductReview = async (req, res, next) => {
    const { rating, comment, productId } = req.body;

    const product = await Product.findById(productId);

    if (!product) {
        return res.status(404).json({
            success: false,
            message: 'Product not found'
        });
    }

    const isReviewed = product.reviews.find(
        (rev) => rev.user.toString() === req.user._id.toString()
    );

    if (isReviewed) {
        product.reviews.forEach((rev) => {
            if (rev.user.toString() === req.user._id.toString()) {
                rev.rating = rating;
                rev.comment = comment;
            }
        });
    } else {
        const newReview = {
            _id: Snowflake.generate(),
            user: req.user._id,
            name: req.user.name,
            rating: Number(rating),
            comment,
        };
        product.reviews.push(newReview);
        product.numOfReviews = product.reviews.length;
    }

    let avg = 0;
    product.reviews.forEach((rev) => {
        avg += rev.rating;
    });
    product.ratings = product.reviews.length > 0 ? avg / product.reviews.length : 0;

    await product.save({ validateBeforeSave: false });

    try {
        const cacheKey = `product:${productId}`;
        await redisClient.del(cacheKey);
        await redisClient.set(`product:${productId}`, JSON.stringify(product));
    } catch (cacheError) {
        console.error('Redis cache invalidation error:', cacheError);
    }

    const io = req.app.get('socketio');
    if (io) {
        io.to(productId).emit('reviewUpdate', {
            reviews: product.reviews,
            ratings: product.ratings,
            numOfReviews: product.numOfReviews,
        });
    }

    res.status(200).json({
        success: true,
    });
};

const getAllWishlistProducts = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).populate('wishlist.product');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const wishlistProducts = user.wishlist.map(item => item.product);

        res.status(200).json({
            success: true,
            wishlistProducts
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
};

const addToWishList = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        const user = await User.findById(req.user._id);

        const isProductInWishlist = user.wishlist.some(
            item => item.product.toString() === req.params.id
        );

        if (isProductInWishlist) {
            return res.status(400).json({
                success: false,
                message: 'Product is already in the wishlist'
            });
        }

        const wishlistItem = {
            _id: Snowflake.generate(),
            product: req.params.id,
            name: product.name,
            description: product.description,
            price: product.price,
            ratings: product.ratings,
            images: product.images
        };

        user.wishlist.push(wishlistItem);
        await user.save();

        const io = req.app.get('socketio');
        if (io) io.to(req.user._id.toString()).emit('wishlistUpdate', user.wishlist);

        res.status(200).json({
            success: true,
            message: 'Product added to wishlist successfully',
            wishlist: user.wishlist
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
};

const removeFromWishList = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        const user = await User.findById(req.user._id);

        const isProductInWishlistIndex = user.wishlist.findIndex(
            item => item.product.toString() === req.params.id
        );

        if (isProductInWishlistIndex === -1) {
            return res.status(400).json({
                success: false,
                message: 'Product is not in the wishlist'
            });
        }

        user.wishlist.splice(isProductInWishlistIndex, 1);
        await user.save();

        const io = req.app.get('socketio');
        if (io) io.to(req.user._id.toString()).emit('wishlistUpdate', user.wishlist);

        res.status(200).json({
            success: true,
            message: 'Product removed from wishlist successfully',
            wishlist: user.wishlist
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
};

// Get all reviews of a product
const getProductReviews = async (req, res, next) => {
    const productId = req.query.id;
    const product = await Product.findById(productId);

    if (!product) {
        return res.status(404).json({
            success: false,
            message: 'Product not found'
        });
    }

    res.status(200).json({
        success: true,
        reviews: product.reviews
    });
};

const deleteReview = async (req, res, next) => {
    const productId = req.query.id;
    const reviewId = req.params.reviewId;

    const product = await Product.findById(productId);

    if (!product) {
        return res.status(404).json({
            success: false,
            message: 'Product not found'
        });
    }

    const reviews = product.reviews.filter(
        rev => rev._id.toString() !== reviewId.toString()
    );

    let avg = 0;
    reviews.forEach(rev => { avg += rev.rating; });

    const ratings = reviews.length === 0 ? 0 : avg / reviews.length;
    const numOfReviews = reviews.length;

    await Product.findByIdAndUpdate(
        productId,
        { reviews, ratings, numOfReviews },
        { new: true, runValidators: true }
    );

    try {
        const cacheKey = `product:${productId}`;
        await redisClient.del(cacheKey);
    } catch (cacheError) {
        console.error('Redis cache invalidation error:', cacheError);
    }

    const io = req.app.get('socketio');
    if (io) {
        io.to(productId).emit('reviewUpdate', {
            reviews: product.reviews,
            ratings: product.ratings,
            numOfReviews: product.numOfReviews,
        });
    }

    res.status(200).json({
        success: true,
        message: 'Review deleted successfully'
    });
};

const summerizeProductReviews = async (req, res, next) => {
    try {
        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({
                success: false,
                message: 'GEMINI_API_KEY not found. Please check your server environment variables.'
            });
        }

        const productId = req.params.id;
        const product = await Product.findById(productId);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found'
            });
        }

        if (product.numOfReviews < 3) {
            return res.status(400).json({
                success: false,
                message: 'Not enough reviews to generate a summary.'
            });
        }

        const reviewsText = product.reviews.map((r) => r.comment).join('\n');
        const prompt = `You are an e-commerce assistant. Based on the following customer reviews, generate a concise summary. The summary should be a string containing a 'Pros' list and a 'Cons' list, each with 2-3 bullet points. Use emojis like ✅ for pros and ⚠️ for cons. Reviews: --- ${reviewsText} ---`;

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(prompt);
        const summary = result.response.text();

        product.aiSummary = summary;
        await product.save();

        try {
            const cacheKey = `product:${productId}`;
            await redisClient.del(cacheKey);
        } catch (cacheError) {
            console.error('Redis cache invalidation error:', cacheError);
        }

        res.status(201).json({
            success: true,
            message: 'Summary generated successfully',
            summary: product.aiSummary,
        });
    } catch (error) {
        console.error('AI Summarization Error:', error);

        if (error.status === 429) {
            return res.status(429).json({
                success: false,
                message: 'The AI summary feature is currently busy. Please try again in a minute.'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Server Error during summarization'
        });
    }
};

// Search products by keyword
const searchProducts = async (req, res, next) => {
    try {
        const keyword = req.query.keyword || '';
        const products = await Product.find({
            $or: [
                { name: { $regex: keyword, $options: 'i' } },
                { description: { $regex: keyword, $options: 'i' } },
            ]
        }).limit(10);

        res.status(200).json({
            success: true,
            products
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

// Autocomplete suggestions
const getAutocompleteSuggestions = async (req, res, next) => {
    try {
        const query = req.query.query || '';
        if (!query) {
            return res.status(200).json({ success: true, suggestions: [] });
        }

        const products = await Product.find(
            { name: { $regex: query, $options: 'i' } },
            { name: 1 }
        ).limit(8);

        const suggestions = products.map(p => p.name);

        res.status(200).json({ success: true, suggestions });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

module.exports = {
    getAllProducts,
    getAdminProducts,
    getProductDetails,
    updateProduct,
    createProductReview,
    getAllWishlistProducts,
    addToWishList,
    removeFromWishList,
    getProductReviews,
    deleteReview,
    summerizeProductReviews,
    searchProducts,
    getAutocompleteSuggestions,
};
