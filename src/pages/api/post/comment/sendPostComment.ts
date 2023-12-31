import { NextApiRequest, NextApiResponse } from "next";

import { CommentData } from "@/components/types/Post";

import { fieldValue, firestore } from "../../../../firebase/adminApp";

import getDisplayName from "@/apiUtils";
import { INotificationServerData } from "@/components/types/User";
import AsyncLock from "async-lock";
import { v4 as uuidv4 } from "uuid";

const lock = new AsyncLock();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { authorization } = req.headers;
  const { comment, postDocPath } = req.body;

  const operationFromUsername = await getDisplayName(authorization as string);
  if (!operationFromUsername)
    return res.status(401).json({ error: "unauthorized" });

  if (req.method !== "POST") return res.status(405).json("Method not allowed");

  if (!comment || !operationFromUsername || !postDocPath) {
    return res.status(422).json({ error: "Invalid prop or props" });
  }

  await lock.acquire(`postCommentAPI-${operationFromUsername}`, async () => {
    const commentTimeStamp = Date.now();
    const newCommentData: CommentData = {
      comment: comment,
      commentSenderUsername: operationFromUsername,
      creationTime: commentTimeStamp,
    };

    let newCommentDocPath = `${postDocPath}/comments/${operationFromUsername}${Date.now()}${uuidv4()
      .replace(/-/g, "")
      .toUpperCase()}`;
    while ((await firestore.doc(newCommentDocPath).get()).exists) {
      newCommentDocPath = `${postDocPath}/comments/${operationFromUsername}${Date.now()}${uuidv4().replace(
        /-/g,
        ""
      )}`;
    }

    try {
      await Promise.all([
        sendComment(newCommentDocPath, newCommentData),
        increaseCommentCount(postDocPath),
      ]);
    } catch (error) {
      console.error("Error while commenting:", error);
      return res.status(503).json({ error: "Firebase error" });
    }

    try {
      const unSlashedPostCommentDocPath = newCommentDocPath.replace(/\//g, "-");

      const newCommentActivityObject = {
        commentTime: commentTimeStamp,
        comment: comment,
        commentedPostDocPath: postDocPath,
      };
      await firestore
        .doc(
          `users/${operationFromUsername}/activities/postActivities/postComments/${unSlashedPostCommentDocPath}`
        )
        .set({ ...newCommentActivityObject });
    } catch (error) {
      console.error(
        "Error while sending comment. (We were updating activities.)",
        error
      );
    }

    // send notification
    let postSenderUsername = "";
    try {
      postSenderUsername = (await firestore.doc(postDocPath).get()).data()
        ?.senderUsername;
    } catch (error) {
      console.error("Error while like. (We were getting post sender username");
    }

    if (postSenderUsername)
      if (operationFromUsername !== postSenderUsername)
        try {
          const newcommentNotificationObject: INotificationServerData = {
            cause: "comment",
            notificationTime: Date.now(),
            seen: false,
            sender: operationFromUsername,
            commentDocPath: newCommentDocPath,
          };
          await firestore
            .collection(`users/${postSenderUsername}/notifications`)
            .add({
              ...newcommentNotificationObject,
            });
        } catch (error) {
          console.error(
            "Error while sending comment. (We were sending notification)",
            error
          );
          return res.status(503).json({ error: "Firebase error" });
        }

    return res.status(200).json({ newCommentDocPath: newCommentDocPath });
  });
}

async function sendComment(
  newCommentDocPath: string,
  newCommentData: CommentData
) {
  try {
    await firestore.doc(newCommentDocPath).set(newCommentData);
  } catch (error) {
    throw new Error(
      `Error while commenting from sendComment function: ${error}`
    );
  }
}

async function increaseCommentCount(postDocPath: string) {
  try {
    await firestore.doc(postDocPath).update({
      commentCount: fieldValue.increment(1),
    });
  } catch (error) {
    throw new Error(
      `Error while commenting from increaseComment function: ${error}`
    );
  }
}
