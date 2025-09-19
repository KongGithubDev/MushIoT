import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Header } from "@/components/layout/Header";
import ChatHeader from "@/components/chat/ChatHeader";
import ChatMessage, { Message } from "@/components/chat/ChatMessage";
import ChatInput from "@/components/chat/ChatInput";
import TypingIndicator from "@/components/chat/TypingIndicator";
import { useSidebar } from "@/contexts/SidebarContext";

const initialMessages: Message[] = [
  {
    id: 1,
    type: 'ai',
    content: "Hello! 🍄 I'm MushBot, your intelligent growing assistant powered by advanced AI. I continuously monitor your system and provide real-time insights to help you achieve the perfect harvest. How can I optimize your mushroom growing experience today?",
    timestamp: new Date(),
    suggestions: [
      "Analyze current conditions",
      "Optimization recommendations",
      "Growing insights",
      "System diagnostics"
    ]
  }
];

const aiResponses = {
  moisture: "Your current soil moisture is at 62% - that's excellent! 🎉 Your mushrooms are in the perfect moisture range (60-80%). The automatic watering system is working great to maintain optimal conditions.",
  watering: "Based on your current moisture level of 62%, you don't need to water right now. 💧 Your mushrooms are happy! I recommend waiting until moisture drops below 40% before the next watering cycle.",
  tips: "Here are my top mushroom growing tips! 🍄\n\n1. **Moisture**: Keep soil between 60-80% for optimal growth\n2. **Consistency**: Avoid sudden moisture changes\n3. **Timing**: Early morning watering works best\n4. **Observation**: Watch for signs of over/under-watering\n5. **Patience**: Good mushrooms take time to develop!\n\nYour automated system is doing a great job maintaining these conditions!",
  pump: "Your water pump is currently OFF and running in AUTO mode. ⚡ It last activated 2 hours ago and ran for 3 minutes. The system is monitoring moisture levels and will activate automatically when needed. Everything looks perfect!",
  general: "I'm here to help with all your mushroom growing questions! 🌿 I can check your current system status, provide growing tips, help with watering decisions, or just chat about your mushroom journey. What would you like to know?"
};

export default function AIChat() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const { sidebarOpen, toggleSidebar } = useSidebar();

  const getAIResponse = (userMessage: string): string => {
    const message = userMessage.toLowerCase();
    if (message.includes('moisture') || message.includes('humidity')) {
      return aiResponses.moisture;
    } else if (message.includes('water') || message.includes('irrigation')) {
      return aiResponses.watering;
    } else if (message.includes('tips') || message.includes('advice') || message.includes('growing')) {
      return aiResponses.tips;
    } else if (message.includes('pump') || message.includes('status') || message.includes('system')) {
      return aiResponses.pump;
    } else {
      return aiResponses.general;
    }
  };

  const sendMessage = async (content: string) => {
    if (!content.trim()) return;

    // Add user message
    const userMessage: Message = {
      id: Date.now(),
      type: 'user',
      content: content.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue("");
    setIsTyping(true);

    // Simulate AI thinking time
    setTimeout(() => {
      const aiResponse: Message = {
        id: Date.now() + 1,
        type: 'ai',
        content: getAIResponse(content),
        timestamp: new Date(),
        suggestions: content.toLowerCase().includes('moisture') ? 
          ["Turn on pump manually", "Set moisture threshold", "View moisture history"] :
          content.toLowerCase().includes('tips') ?
          ["Check current status", "View watering history", "Adjust settings"] :
          ["What's my moisture level?", "Any growing tips?", "Check system status"]
      };

      setMessages(prev => [...prev, aiResponse]);
      setIsTyping(false);
    }, 1000 + Math.random() * 2000);
  };

  const handleSuggestionClick = (suggestion: string) => {
    sendMessage(suggestion);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputValue);
  };

  return (
    <>
      <Header onMenuClick={toggleSidebar} />
      <ChatHeader />
      
      {/* Messages Area - using negative margins to extend beyond Layout padding */}
      <div className={`fixed inset-0 top-[158px] bottom-[88px] overflow-hidden transition-all duration-300 ${sidebarOpen ? 'left-sidebar' : 'left-16'}`}>
        <ScrollArea className="h-full">
          <div className="max-w-4xl mx-auto px-4 md:px-6 py-6">
            <div className="space-y-6">
              {messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))}

              {isTyping && <TypingIndicator />}
            </div>
          </div>
        </ScrollArea>
      </div>

      <ChatInput
        inputValue={inputValue}
        setInputValue={setInputValue}
        onSubmit={handleSubmit}
        isTyping={isTyping}
        onSuggestionClick={handleSuggestionClick}
      />
    </>
  );
}