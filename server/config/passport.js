// server/config/passport.js

import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from '../models/User.js';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' }); // Try hardcoded relative to passport.js
console.log("🔁 Google Callback URL being used:", process.env.GOOGLE_CALLBACK_URL);


passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
      scope: ['profile', 'email']
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({ googleId: profile.id });

        if (user) {
          return done(null, user);
        }

        // Create new user
        user = new User({
          googleId: profile.id,
          name: profile.displayName,
          email: profile.emails[0].value,
          photo: profile.photos[0].value,
          password: 'google_oauth_placeholder' // Not used
        });

        await user.save();
        done(null, user);
      } catch (err) {
        done(err, null);
      }
    }
  )
);

// Serialize user (store in session)
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

export default passport;