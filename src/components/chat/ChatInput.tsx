import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Mic } from "lucide-react";
import { useSidebar } from "@/contexts/SidebarContext";

interface ChatInputProps {
  inputValue: string;
  setInputValue: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isTyping: boolean;
  onSuggestionClick: (suggestion: string) => void;
}

export default function ChatInput({ 
  inputValue, 
  setInputValue, 
  onSubmit, 
  isTyping, 
  onSuggestionClick 
}: ChatInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { sidebarOpen } = useSidebar();

  return (
    <div className={`fixed bottom-0 right-0 z-40 border-t bg-background/95 backdrop-blur-sm shadow-lg transition-all duration-300 ${sidebarOpen ? 'left-sidebar' : 'left-16'}`}>
      <div className="w-full p-4">
        {/* Message Input */}
        <form onSubmit={onSubmit} className="flex gap-3">
          <div className="flex-1 relative">
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask MushBot anything..."
              disabled={isTyping}
              className="rounded-full border-0 bg-muted/60 pr-12 focus-visible:ring-1 focus-visible:ring-primary/50"
            />
            <Button 
              type="button" 
              variant="ghost" 
              size="icon" 
              className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full hover:bg-muted/80"
            >
              <Mic className="h-4 w-4" />
            </Button>
          </div>
          <Button 
            type="submit" 
            disabled={!inputValue.trim() || isTyping}
            size="icon"
            className="rounded-full h-10 w-10 shadow-sm"
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}