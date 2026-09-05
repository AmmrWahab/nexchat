// server/config/passport.js

import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from '../models/User.js';
import dotenv from 'dotenv';
dotenv.config({ path: './.env' }); // Try hardcoded relative to passport.js

// Resolve the Google callback URL. In production (Render), Render injects
// RENDER_EXTERNAL_URL automatically, so we fall back to it when the configured
// URL is missing or still points at localhost.
let callbackURL = process.env.GOOGLE_CALLBACK_URL;
if (!callbackURL || /localhost|127\.0\.0\.1/.test(callbackURL)) {
  if (process.env.RENDER_EXTERNAL_URL) {
    callbackURL = `${process.env.RENDER_EXTERNAL_URL}/api/auth/google/callback`;
  } else {
    callbackURL = callbackURL || 'http://localhost:5000/api/auth/google/callback';
  }
}
console.log("Google Callback URL being used:", callbackURL);


passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL,
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