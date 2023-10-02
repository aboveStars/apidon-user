import { UserInServer } from "@/components/types/User";
import AsyncLock from "async-lock";
import { AuthError } from "firebase/auth";
import type { NextApiRequest, NextApiResponse } from "next";
import { auth, firestore } from "../../firebase/adminApp";

const lock = new AsyncLock();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { email, fullname, username, password, captchaToken } = req.body;

  let response: Response;
  try {
    response = await fetch(
      `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.NEXT_PUBLIC_RECAPTCHA_SECRET_KEY}&response=${captchaToken}`,
      {
        method: "POST",
      }
    );
  } catch (error) {
    console.error(
      "Error on signUp.(We were fetching to 'googleRepactchaService'.)",
      error
    );
    return res.status(503).json({ error: "Recaptcha Server Error" });
  }

  if (!(await response.json()).success)
    return res
      .status(401)
      .json({ error: "reCaptcha human verification resulted false." });

  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  await lock.acquire(`signupAPI-${username}`, async () => {
    const emailRegex =
      /^[A-Za-z0-9._%+-]+@(gmail|yahoo|outlook|aol|icloud|protonmail|yandex|mail|zoho)\.(com|net|org)$/i;
    if (!emailRegex.test(email)) {
      return res.status(422).json({ error: "Invalid Email" });
    }
    const fullnameRegex = /^[\p{L}_ ]{3,20}$/u;
    const consecutiveSpaceRegex = /\s\s/;
    if (
      !fullnameRegex.test(fullname) ||
      consecutiveSpaceRegex.test(fullname) ||
      fullname[fullname.length - 1] === " "
    ) {
      return res.status(422).json({ error: "Invalid Fullname" });
    }
    const usernameRegex = /^[a-z0-9]{3,20}$/;
    if (!usernameRegex.test(username)) {
      return res.status(422).json({ error: "Invalid Username" });
    }

    let usernameDoc;
    try {
      usernameDoc = await firestore.doc(`usernames/${username}`).get();
    } catch (error) {
      console.error(
        "Error while signup.(We were checking if username is taken)",
        error
      );
      return res.status(503).json({ error: "Firebase error" });
    }

    if (usernameDoc.exists) {
      return res.status(409).json({ error: "Username taken" });
    }

    const passwordRegex =
      /^(?=.*?\p{Lu})(?=.*?\p{Ll})(?=.*?\d)(?=.*?[^\w\s]|[_]).{12,}$/u;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({ error: "Invalid Password" });
    }

    let newUserData: UserInServer;
    let createdUid;
    try {
      const { uid } = await auth.createUser({
        email: email,
        password: password,
        displayName: username,
      });
      createdUid = uid;
    } catch (error) {
      console.error("Error while signup. (We were creating user)", error);
      const err = error as AuthError;
      return res.status(503).json({ error: err.message });
    }

    try {
      const batch = firestore.batch();
      batch.set(firestore.doc(`usernames/${username}`), {});
      newUserData = {
        username: username,
        fullname: fullname,
        profilePhoto: "",

        followingCount: 0,
        followerCount: 0,
        nftCount: 0,

        email: email || "",
        uid: createdUid,
      };
      batch.set(firestore.doc(`users/${username}`), newUserData);
      await batch.commit();
    } catch (error) {
      console.error("Error while signup. (We were creating docs)", error);
      return res.status(503).json({ error: error });
    }
    return res.status(200).json(newUserData);
  });
}
