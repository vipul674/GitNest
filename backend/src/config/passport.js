import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";

import User from "../models/User.model.js";

passport.use(
  new GitHubStrategy(
    {
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: process.env.GITHUB_CALLBACK_URL,
      scope: ["user:email"],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({
          githubId: profile.id,
        });

        if (!user) {
          const email = profile.emails?.[0]?.value;

          console.log("GitHub Profile:", {
            username: profile.username,
            email: profile.emails?.[0]?.value,
            githubId: profile.id,
          });

          user = await User.create({
            username: profile.username,
            email,
            githubId: profile.id,
            avatar: profile.photos?.[0]?.value,
          });
        }

        return done(null, user);
      } catch (error) {
        console.error("========== GITHUB OAUTH ERROR ==========");
        console.error(error);
        console.error(error.errors);
        console.error("========================================");
        return done(error, null);
      }
    },
  ),
);

export default passport;
