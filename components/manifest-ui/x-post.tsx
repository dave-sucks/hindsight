"use client";

import {
  Bookmark,
  Heart,
  MessageCircle,
  Repeat2,
  Share,
} from "lucide-react";

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
 * X (Twitter) post card.
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
  const views = data?.views;
  const verified = data?.verified;

  if (!author && !content) {
    return null;
  }

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex gap-3">
        {avatar && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background">
            {avatar}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {(author || username || time) && (
            <div className="flex flex-wrap items-center gap-1">
              {author && (
                <span className="text-sm font-bold">{author}</span>
              )}
              {verified && (
                <svg
                  className="h-4 w-4 text-blue-500"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.998-3.818-3.998-.47 0-.92.084-1.336.25C14.818 2.415 13.51 1.5 12 1.5s-2.816.917-3.437 2.25c-.415-.165-.866-.25-1.336-.25-2.11 0-3.818 1.79-3.818 4 0 .494.083.964.237 1.4-1.272.65-2.147 2.018-2.147 3.6 0 1.495.782 2.798 1.942 3.486-.02.17-.032.34-.032.514 0 2.21 1.708 4 3.818 4 .47 0 .92-.086 1.335-.25.62 1.334 1.926 2.25 3.437 2.25 1.512 0 2.818-.916 3.437-2.25.415.163.865.248 1.336.248 2.11 0 3.818-1.79 3.818-4 0-.174-.012-.344-.033-.513 1.158-.687 1.943-1.99 1.943-3.484zm-6.616-3.334l-4.334 6.5c-.145.217-.382.334-.625.334-.143 0-.288-.04-.416-.126l-.115-.094-2.415-2.415c-.293-.293-.293-.768 0-1.06s.768-.294 1.06 0l1.77 1.767 3.825-5.74c.23-.345.696-.436 1.04-.207.346.23.44.696.21 1.04z" />
                </svg>
              )}
              {username && (
                <span className="text-sm text-muted-foreground">
                  @{username}
                </span>
              )}
              {time && (
                <span className="text-sm text-muted-foreground">
                  · {time}
                </span>
              )}
            </div>
          )}
          {content && (
            <p className="mt-1 whitespace-pre-wrap text-sm">{content}</p>
          )}
          {(replies || retweets || likes || views) && (
            <div className="mt-3 flex max-w-md items-center justify-between text-muted-foreground">
              {replies !== undefined && (
                <button
                  aria-label="Reply"
                  className="flex cursor-pointer items-center gap-1.5 text-xs transition-colors hover:text-blue-500"
                >
                  <MessageCircle className="h-4 w-4" />
                  <span>{replies}</span>
                </button>
              )}
              {retweets !== undefined && (
                <button
                  aria-label="Repost"
                  className="flex cursor-pointer items-center gap-1.5 text-xs transition-colors hover:text-green-500"
                >
                  <Repeat2 className="h-4 w-4" />
                  <span>{retweets}</span>
                </button>
              )}
              {likes !== undefined && (
                <button
                  aria-label="Like"
                  className="flex cursor-pointer items-center gap-1.5 text-xs transition-colors hover:text-pink-500"
                >
                  <Heart className="h-4 w-4" />
                  <span>{likes}</span>
                </button>
              )}
              {views !== undefined && (
                <button
                  aria-label="Views"
                  className="flex cursor-pointer items-center gap-1.5 text-xs transition-colors hover:text-blue-500"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M3 12h4l3 8 4-16 3 8h4" />
                  </svg>
                  <span>{views}</span>
                </button>
              )}
              <button
                aria-label="Bookmark"
                className="cursor-pointer transition-colors hover:text-blue-500"
              >
                <Bookmark className="h-4 w-4" />
              </button>
              <button
                aria-label="Share"
                className="cursor-pointer transition-colors hover:text-blue-500"
              >
                <Share className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
