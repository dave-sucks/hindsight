"use client";

import { Heart, MessageCircle, Repeat2 } from "lucide-react";

export interface XPostProps {
  data?: {
    author?: string;
    username?: string;
    avatar?: string;
    content?: string;
    time?: string;
    likes?: string;
    retweets?: string;
    replies?: string;
    views?: string;
    verified?: boolean;
  };
}

/**
 * X (Twitter) post card — read-only social sentiment display.
 */
export function XPost({ data }: XPostProps) {
  const author = data?.author;
  const username = data?.username;
  const avatar = data?.avatar;
  const content = data?.content;
  const time = data?.time;
  const likes = data?.likes;
  const retweets = data?.retweets;
  const replies = data?.replies;
  const verified = data?.verified;

  if (!author && !content) {
    return null;
  }

  // First letter of author or avatar text for the circle
  const avatarLetter = avatar
    ? avatar.charAt(0).toUpperCase()
    : author
      ? author.charAt(0).toUpperCase()
      : "?";

  return (
    <div className="rounded-xl border bg-card px-3.5 py-3">
      <div className="flex gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
          {avatarLetter}
        </div>
        <div className="min-w-0 flex-1">
          {(author || username || time) && (
            <div className="flex flex-wrap items-center gap-1">
              {author && (
                <span className="text-xs font-semibold">{author}</span>
              )}
              {verified && (
                <svg
                  className="h-3.5 w-3.5 text-blue-500"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484zm-6.616-3.334l-4.334 6.5c-.145.217-.382.334-.625.334-.143 0-.288-.04-.416-.126l-.115-.094-2.415-2.415c-.293-.293-.293-.768 0-1.06s.768-.294 1.06 0l1.77 1.767 3.825-5.74c.23-.345.696-.436 1.04-.207.346.23.44.696.21 1.04z" />
                </svg>
              )}
              {username && (
                <span className="text-xs text-muted-foreground">
                  @{username}
                </span>
              )}
              {time && (
                <span className="text-xs text-muted-foreground">
                  · {time}
                </span>
              )}
            </div>
          )}
          {content && (
            <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
              {content}
            </p>
          )}
          {(replies || retweets || likes) && (
            <div className="mt-2 flex items-center gap-4 text-muted-foreground">
              {replies !== undefined && (
                <span className="flex items-center gap-1 text-[10px]">
                  <MessageCircle className="h-3 w-3" />
                  {replies}
                </span>
              )}
              {retweets !== undefined && (
                <span className="flex items-center gap-1 text-[10px]">
                  <Repeat2 className="h-3 w-3" />
                  {retweets}
                </span>
              )}
              {likes !== undefined && (
                <span className="flex items-center gap-1 text-[10px]">
                  <Heart className="h-3 w-3" />
                  {likes}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
