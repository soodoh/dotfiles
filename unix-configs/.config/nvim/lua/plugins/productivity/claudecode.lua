return {
  {
    "coder/claudecode.nvim",
    dependencies = { "folke/snacks.nvim" },
    config = true,
    keys = {
      { "<leader>a", nil, desc = "AI/Claude Code" },
      { "<leader>ac", ":ClaudeCode<CR>", desc = "Toggle Claude" },
      { "<leader>af", ":ClaudeCodeFocus<CR>", desc = "Focus Claude" },
      {
        "<leader>ar",
        ":ClaudeCode --resume<CR>",
        desc = "Resume Claude",
      },
      {
        "<leader>aC",
        ":ClaudeCode --continue<CR>",
        desc = "Continue Claude",
      },
      {
        "<leader>am",
        ":ClaudeCodeSelectModel<CR>",
        desc = "Select Claude model",
      },
      {
        "<leader>ab",
        ":ClaudeCodeAdd %<CR>",
        desc = "Add current buffer",
      },
      {
        "<leader>as",
        ":ClaudeCodeSend<CR>",
        mode = "v",
        desc = "Send to Claude",
      },
      {
        "<leader>as",
        ":ClaudeCodeTreeAdd<CR>",
        desc = "Add file",
        ft = { "NvimTree", "neo-tree", "oil", "minifiles", "netrw" },
      },
      -- Diff management
      {
        "<leader>aa",
        ":ClaudeCodeDiffAccept<CR>",
        desc = "Accept diff",
      },
      { "<leader>ad", ":ClaudeCodeDiffDeny<CR>", desc = "Deny diff" },
    },
  },
}
